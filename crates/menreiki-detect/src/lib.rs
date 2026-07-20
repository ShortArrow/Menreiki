//! Rule-based detection over OCR results.
//!
//! Scans recognized text lines with regular expressions and maps each match
//! back to page coordinates through the word boxes that overlap it, so a
//! finding always knows both what was written and where it sits.

use std::collections::{HashMap, HashSet};
use std::ops::Range;

use menreiki_core::{Finding, PageOcr, Rect, Span};
use regex::Regex;

/// A detection rule: text matching `pattern` is reported as `category`,
/// attributed to `detector` ("regex" or "dictionary").
pub struct RegexRule {
    category: String,
    detector: String,
    pattern: Regex,
    /// Whether this is a built-in name heuristic (organization, department,
    /// person, place) rather than an exact user string. Heuristic matches
    /// get suffix-boundary filtering so a suffix character inside a compound
    /// word (部 in 部位, 市 in 市場) is not mistaken for a name; user
    /// searches and dictionary terms are matched verbatim without it.
    heuristic: bool,
}

impl RegexRule {
    pub fn new(category: &str, pattern: &str) -> Result<Self, regex::Error> {
        Ok(Self {
            category: category.to_string(),
            detector: "regex".to_string(),
            pattern: Regex::new(pattern)?,
            heuristic: false,
        })
    }

    /// A user-dictionary rule: matches `text` with the same OCR tolerance
    /// as [`Self::literal`], reported under the entry's own category and
    /// attributed to the dictionary.
    pub fn dictionary(category: &str, text: &str) -> Self {
        let mut rule = Self::literal(category, text);
        rule.detector = "dictionary".to_string();
        rule
    }

    /// A rule matching `text` the way OCR may have read it — the path for
    /// user-supplied strings (search, dictionaries, policy text rules,
    /// audit deny terms).
    ///
    /// Tolerated OCR variations, applied per character of the term:
    /// - spurious whitespace (CJK engines split lines into one-character
    ///   words, scattering spaces)
    /// - hiragana/katakana homoglyphs (ベ read as べ)
    /// - dash-like character confusions (- read as ー)
    pub fn literal(category: &str, text: &str) -> Self {
        let pattern = text
            .chars()
            .filter(|character| !character.is_whitespace())
            .map(confusable_class)
            .collect::<Vec<_>>()
            .join(r"\s*");
        Self::new(category, &pattern).expect("escaped literal is a valid pattern")
    }

    /// Marks this rule as a built-in name heuristic (enables suffix-boundary
    /// filtering in [`detect_page`]).
    fn heuristic(mut self) -> Self {
        self.heuristic = true;
        self
    }
}

/// Single-character name suffixes that are only meaningful at a word
/// boundary: 技術開発部 is a department, but 部 inside 部位 / 部品 is not, and
/// 市 inside 市場 is not a place.
const BOUNDARY_SUFFIXES: &str = "部課係都府県市区町村氏殿";

/// Decides whether a heuristic match ends a name rather than sitting inside a
/// compound word. A match ending in a boundary suffix is a compound (not a
/// name) when another ideograph follows it — 部位, 部品, 市場, 氏名 — with 長
/// the one exception, since it marks a title on a real unit (営業部長 → 営業部).
fn heuristic_match_ends_a_name(matched: &str, following: Option<char>) -> bool {
    let Some(last) = matched.chars().last() else {
        return true;
    };
    if !BOUNDARY_SUFFIXES.contains(last) {
        return true;
    }
    match following {
        Some(next) if is_ideograph(next) => next == '長',
        _ => true,
    }
}

fn is_ideograph(character: char) -> bool {
    ('\u{4E00}'..='\u{9FFF}').contains(&character)
}

/// Dash-like characters OCR commonly confuses with each other, e.g. the
/// katakana prolonged sound mark read from a hyphen in "045-123-4567".
const DASH_CHARS: &str = "-‐‑–—−ー";

/// A regex fragment matching `character` and everything OCR plausibly
/// confuses it with.
fn confusable_class(character: char) -> String {
    let mut variants = vec![character];
    let code = character as u32;
    if let Some(counterpart) = match code {
        0x30A1..=0x30F6 => char::from_u32(code - 0x60),
        0x3041..=0x3096 => char::from_u32(code + 0x60),
        _ => None,
    } {
        variants.push(counterpart);
    }
    if DASH_CHARS.contains(character) {
        variants.extend(DASH_CHARS.chars().filter(|dash| *dash != character));
    }

    if variants.len() == 1 {
        regex::escape(&character.to_string())
    } else {
        let mut class = String::from("[");
        for variant in variants {
            class.push_str(&regex::escape(&variant.to_string()));
        }
        class.push(']');
        class
    }
}

/// Characters that may appear inside a Japanese name. Covers CJK ideographs
/// including Extension A and the compatibility block (so surname variants
/// such as 﨑 U+FA11 do not split a name), the iteration mark 々, katakana,
/// and Latin/digits. Hiragana is excluded on purpose: it terminates the name
/// so surrounding particles (「〜した」「〜から」) never leak into the match.
const ORG_CHAR: &str = r"[\u{3005}\u{3400}-\u{9FFF}\u{F900}-\u{FAFF}ァ-ヶーA-Za-z0-9]";

/// Spaced-tolerant spellings of company legal forms. `\s*` (not `\s?`)
/// absorbs any number of spurious OCR spaces between the characters.
fn legal_forms() -> String {
    ["株式会社", "有限会社", "合同会社"]
        .map(|form| {
            form.chars()
                .map(|c| regex::escape(&c.to_string()))
                .collect::<Vec<_>>()
                .join(r"\s*")
        })
        .join("|")
}

/// Words a name-suffix heuristic would otherwise flag (都市, 政府, 彼氏…);
/// candidates matching one of these exactly are dropped.
const HEURISTIC_STOPWORDS: [&str; 7] =
    ["都市", "首都", "政府", "地区", "彼氏", "摂氏", "華氏"];

/// Built-in rules for mechanically detectable identifiers. Patterns accept
/// common OCR confusions (dash variants, a lost colon in URLs) so that a
/// recognizable identifier is still flagged. The name heuristics
/// deliberately over-trigger — findings are candidates for human review,
/// and a missed name costs more than a rejected candidate.
pub fn builtin_rules() -> Vec<RegexRule> {
    let forms = legal_forms();
    let name_heuristics = [
        (
            "organization",
            format!(
                "(?:{forms})(?:\\s*{ORG_CHAR}){{1,20}}\
                 |(?:{ORG_CHAR}\\s*){{1,20}}(?:{forms})\
                 |(?:{ORG_CHAR}\\s*){{2,20}}(?:グループ|ホールディングス)"
            ),
        ),
        (
            "department",
            format!(
                "(?:{ORG_CHAR}\\s*){{1,20}}(?:部門|事業部|本部|支社|支店|営業所|研究所|製作所)\
                 |(?:{ORG_CHAR}\\s*){{2,20}}[部課係]"
            ),
        ),
        (
            "person",
            format!("(?:{ORG_CHAR}\\s*){{1,4}}(?:氏|殿|さん)"),
        ),
        (
            "place",
            format!("(?:{ORG_CHAR}\\s*){{1,6}}[都府県市区町村]|北\\s*海\\s*道"),
        ),
    ]
    .into_iter()
    .map(|(category, pattern)| {
        RegexRule::new(category, &pattern)
            .expect("built-in pattern is valid")
            .heuristic()
    });

    let mechanical = [
        (
            "email",
            r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}".to_string(),
        ),
        (
            "url",
            r"https?\s?:?//[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+".to_string(),
        ),
        ("ip-address", r"\b(?:\d{1,3}\.){3}\d{1,3}\b".to_string()),
        (
            "phone",
            format!(
                r"[（(]0\d{{1,4}}[)）]\s?\d{{1,4}}[{DASH_CHARS}]\d{{4}}\b|\b0\d{{1,4}}[（(]\d{{1,4}}[)）]\d{{4}}\b|\b0\d{{1,4}}[{DASH_CHARS}]\d{{1,4}}[{DASH_CHARS}]\d{{4}}\b"
            ),
        ),
        (
            "postal-code",
            format!(r"(?:〒\s?)?\b\d{{3}}[{DASH_CHARS}]\d{{4}}\b"),
        ),
        (
            "date",
            r"\d{4}\s?年\s?\d{1,2}\s?月\s?\d{1,2}\s?日|\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b"
                .to_string(),
        ),
    ]
    .into_iter()
    .map(|(category, pattern)| {
        RegexRule::new(category, &pattern).expect("built-in pattern is valid")
    });

    name_heuristics.chain(mechanical).collect()
}

/// Applies every rule to every recognized line of a page.
pub fn detect_page(page: &PageOcr, rules: &[RegexRule]) -> Vec<Finding> {
    let mut findings = Vec::new();
    for line in &page.lines {
        let words = locate_words(&line.text, &line.words);
        let line_rect = union_rects(words.iter().map(|(_, rect)| *rect));
        for rule in rules {
            for matched in rule.pattern.find_iter(&line.text) {
                if HEURISTIC_STOPWORDS.contains(&matched.as_str()) {
                    continue;
                }
                if rule.heuristic {
                    let following = line.text[matched.end()..].chars().next();
                    if !heuristic_match_ends_a_name(matched.as_str(), following) {
                        continue;
                    }
                }
                let rect = rect_for_range(matched.range(), &words)
                    .or(line_rect)
                    .unwrap_or(EMPTY_RECT);
                findings.push(Finding {
                    category: rule.category.clone(),
                    text: matched.as_str().to_string(),
                    rect,
                    detector: rule.detector.clone(),
                    note: None,
                });
            }
        }
    }
    findings
}

/// Finds text lines that repeat at the same vertical position across pages —
/// header, footer, and page-number removal candidates. ASCII digits are
/// ignored when comparing text, so "Page 1" and "Page 2" group together.
/// Returns one findings list per page, ordered top to bottom.
pub fn detect_repeated_lines(pages: &[PageOcr]) -> Vec<Vec<Finding>> {
    let mut groups: HashMap<(String, u32), Vec<(usize, Rect, String)>> = HashMap::new();
    for (page_index, page) in pages.iter().enumerate() {
        if page.height == 0 {
            continue;
        }
        for line in &page.lines {
            let Some(rect) = union_rects(line.words.iter().map(|word| word.rect)) else {
                continue;
            };
            let normalized = layout_grouping_key(&line.text);
            if normalized.is_empty() {
                continue;
            }
            let band = (vertical_center(&rect, page.height) * 50.0) as u32;
            groups
                .entry((normalized, band))
                .or_default()
                .push((page_index, rect, line.text.clone()));
        }
    }

    let required_pages = (pages.len() / 2).max(2);
    let mut findings = vec![Vec::new(); pages.len()];
    for occurrences in groups.into_values() {
        let distinct_pages: HashSet<usize> = occurrences
            .iter()
            .map(|(page_index, _, _)| *page_index)
            .collect();
        if distinct_pages.len() < required_pages {
            continue;
        }
        for (page_index, rect, text) in occurrences {
            let center = vertical_center(&rect, pages[page_index].height);
            let category = if center < 0.2 {
                "header"
            } else if center > 0.8 {
                "footer"
            } else {
                "repeated-text"
            };
            findings[page_index].push(Finding {
                category: category.to_string(),
                text,
                rect,
                detector: "layout".to_string(),
                note: None,
            });
        }
    }
    for page in &mut findings {
        page.sort_by(|a, b| {
            (a.rect.y, a.rect.x)
                .partial_cmp(&(b.rect.y, b.rect.x))
                .expect("finding coordinates are finite")
        });
    }
    findings
}

fn vertical_center(rect: &Rect, page_height: u32) -> f32 {
    (rect.y + rect.height / 2.0) / page_height as f32
}

/// Key for grouping the "same" line across pages: whitespace is dropped
/// (OCR spacing varies page to page, and letter-spaced text like
/// 「菊 水 電 子 工 業」 splits into one word per character) and digits
/// collapse to '#' so numbered footers ("Page 1", "Page 2") group together.
fn layout_grouping_key(text: &str) -> String {
    text.chars()
        .filter(|character| !character.is_whitespace())
        .map(|character| {
            if character.is_ascii_digit() {
                '#'
            } else {
                character
            }
        })
        .collect()
}

const EMPTY_RECT: Rect = Rect {
    x: 0.0,
    y: 0.0,
    width: 0.0,
    height: 0.0,
};

/// Byte range each word occupies inside the line text, found by scanning
/// forward so repeated words map to their own occurrence.
fn locate_words(line_text: &str, words: &[Span]) -> Vec<(Range<usize>, Rect)> {
    let mut cursor = 0;
    let mut located = Vec::new();
    for word in words {
        if let Some(position) = line_text[cursor..].find(&word.text) {
            let start = cursor + position;
            let range = start..start + word.text.len();
            cursor = range.end;
            located.push((range, word.rect));
        }
    }
    located
}

fn rect_for_range(matched: Range<usize>, words: &[(Range<usize>, Rect)]) -> Option<Rect> {
    let overlapping = words
        .iter()
        .filter(|(range, _)| range.start < matched.end && matched.start < range.end)
        .map(|(_, rect)| *rect);
    union_rects(overlapping)
}

fn union_rects(mut rects: impl Iterator<Item = Rect>) -> Option<Rect> {
    let first = rects.next()?;
    Some(rects.fold(first, |unioned, rect| unioned.union(&rect)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use menreiki_core::OcrLine;

    fn line(text: &str) -> OcrLine {
        let mut x = 0.0;
        let words = text
            .split_whitespace()
            .map(|word| {
                let rect = Rect {
                    x,
                    y: 10.0,
                    width: word.len() as f32 * 10.0,
                    height: 20.0,
                };
                x += rect.width + 10.0;
                Span {
                    text: word.to_string(),
                    rect,
                }
            })
            .collect();
        OcrLine {
            text: text.to_string(),
            words,
        }
    }

    fn page(texts: &[&str]) -> PageOcr {
        PageOcr {
            width: 1000,
            height: 100,
            lines: texts.iter().map(|text| line(text)).collect(),
        }
    }

    #[test]
    fn finds_email_with_word_coordinates() {
        let page = page(&["Contact: taro@example.com today"]);

        let findings = detect_page(&page, &builtin_rules());

        assert_eq!(findings.len(), 1);
        let finding = &findings[0];
        assert_eq!(finding.category, "email");
        assert_eq!(finding.text, "taro@example.com");
        assert_eq!(finding.detector, "regex");
        let word_rect = &page.lines[0].words[1].rect;
        assert_eq!(finding.rect, *word_rect);
    }

    #[test]
    fn finds_multiple_categories_across_lines() {
        let page = page(&[
            "tel: 03-1234-5678",
            "server 192.168.10.21 at https://example.com/path",
            "納期 2026年7月17日",
        ]);

        let findings = detect_page(&page, &builtin_rules());

        let categories: Vec<&str> = findings
            .iter()
            .map(|finding| finding.category.as_str())
            .collect();
        assert!(categories.contains(&"phone"));
        assert!(categories.contains(&"ip-address"));
        assert!(categories.contains(&"url"));
        assert!(categories.contains(&"date"));
    }

    #[test]
    fn match_spanning_words_unions_their_rects() {
        let page = page(&["reach admin @example.com"]);
        let rules = vec![RegexRule::new("email-like", r"admin @example\.com").unwrap()];

        let findings = detect_page(&page, &rules);

        assert_eq!(findings.len(), 1);
        let second = &page.lines[0].words[1].rect;
        let third = &page.lines[0].words[2].rect;
        assert_eq!(findings[0].rect, second.union(third));
    }

    #[test]
    fn clean_page_yields_no_findings() {
        let page = page(&["nothing sensitive here"]);

        assert!(detect_page(&page, &builtin_rules()).is_empty());
    }

    #[test]
    fn literal_rule_matches_verbatim_including_regex_metacharacters() {
        let page = page(&["order (A+B) confirmed"]);
        let rules = vec![RegexRule::literal("order-code", "(A+B)")];

        let findings = detect_page(&page, &rules);

        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].text, "(A+B)");
    }

    #[test]
    fn literal_rule_tolerates_ocr_spacing() {
        let page = page(&["宛先 株式会社アル フ ァ技研 御中"]);
        let rules = vec![RegexRule::literal("organization", "株式会社アルファ技研")];

        let findings = detect_page(&page, &rules);

        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].text, "株式会社アル フ ァ技研");
    }

    #[test]
    fn literal_rule_tolerates_fully_letter_spaced_text() {
        let page = page(&["ガ  ン  マ  電  子  工  業  御中"]);
        let rules = vec![RegexRule::literal("organization", "ガンマ電子工業")];

        let findings = detect_page(&page, &rules);

        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].text, "ガ  ン  マ  電  子  工  業");
    }

    #[test]
    fn repeated_lines_group_despite_spacing_differences() {
        let pages = vec![
            page_with_line_at("body one", "ガ ン マ 電 子 工 業", 950.0),
            page_with_line_at("body two", "ガンマ 電子 工業", 950.0),
        ];

        let findings = detect_repeated_lines(&pages);

        assert_eq!(findings[0].len(), 1);
        assert_eq!(findings[1].len(), 1);
        assert_eq!(findings[0][0].category, "footer");
    }

    #[test]
    fn literal_rule_tolerates_kana_homoglyphs() {
        let page = page(&["発注先は株式会社べータ電機とする"]);
        let rules = vec![RegexRule::literal("organization", "株式会社ベータ電機")];

        let findings = detect_page(&page, &rules);

        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].text, "株式会社べータ電機");
    }

    #[test]
    fn company_names_are_flagged_as_organization_candidates() {
        let page = page(&[
            "本書は、株式会社ベータ電機から受領した",
            "納入元はベータ電子株式会社とする",
            "担当は 株 式 会 社 アルファ技研 のもの",
        ]);

        let findings = detect_page(&page, &builtin_rules());

        let organizations: Vec<&str> = findings
            .iter()
            .filter(|finding| finding.category == "organization")
            .map(|finding| finding.text.as_str())
            .collect();
        assert!(
            organizations.contains(&"株式会社ベータ電機"),
            "found: {organizations:?}"
        );
        assert!(
            organizations.contains(&"ベータ電子株式会社"),
            "found: {organizations:?}"
        );
        assert!(
            organizations
                .iter()
                .any(|text| text.contains("アルファ技研")),
            "found: {organizations:?}"
        );
    }

    #[test]
    fn departments_people_and_places_are_flagged() {
        let page = page(&[
            "技術開発部の田中氏が担当する",
            "アルファグループ各社および横浜市の拠点",
            "詳細は佐藤さんと第二営業課まで",
        ]);

        let findings = detect_page(&page, &builtin_rules());

        let by_category = |category: &str| -> Vec<&str> {
            findings
                .iter()
                .filter(|finding| finding.category == category)
                .map(|finding| finding.text.as_str())
                .collect()
        };
        assert!(
            by_category("department").contains(&"技術開発部"),
            "departments: {:?}",
            by_category("department")
        );
        assert!(
            by_category("department").contains(&"第二営業課"),
            "departments: {:?}",
            by_category("department")
        );
        assert!(
            by_category("person").contains(&"田中氏"),
            "people: {:?}",
            by_category("person")
        );
        assert!(
            by_category("person").contains(&"佐藤さん"),
            "people: {:?}",
            by_category("person")
        );
        assert!(
            by_category("organization").contains(&"アルファグループ"),
            "organizations: {:?}",
            by_category("organization")
        );
        assert!(
            by_category("place").contains(&"横浜市"),
            "places: {:?}",
            by_category("place")
        );
    }

    #[test]
    fn heuristic_stopwords_are_not_flagged() {
        let page = page(&["都市計画は政府と地区の方針による"]);

        let findings = detect_page(&page, &builtin_rules());

        assert!(
            findings.is_empty(),
            "unexpected findings: {:?}",
            findings
                .iter()
                .map(|finding| finding.text.as_str())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn company_name_stays_whole_across_variant_kanji_and_ocr_gaps() {
        let page = page(&[
            "取引先は猫﨑電気産業株式会社である",
            "検収は猫崎  電気産業株式会社が行う",
        ]);

        let findings = detect_page(&page, &builtin_rules());

        let orgs: Vec<&str> = findings
            .iter()
            .filter(|f| f.category == "organization")
            .map(|f| f.text.as_str())
            .collect();
        assert!(
            orgs.iter()
                .any(|text| text.starts_with("猫﨑") && text.ends_with("株式会社")),
            "variant kanji split the name: {orgs:?}"
        );
        assert!(
            orgs.iter()
                .any(|text| text.starts_with("猫崎") && text.ends_with("株式会社")),
            "an OCR gap split the name: {orgs:?}"
        );
    }

    #[test]
    fn suffix_inside_a_compound_word_is_not_a_name() {
        let page = page(&[
            "当該部位を確認する",
            "固有部品の一覧を添付する",
            "青果市場で価格を調査した",
            "氏名と住所を記入する",
        ]);

        let findings = detect_page(&page, &builtin_rules());

        let texts: Vec<&str> = findings.iter().map(|f| f.text.as_str()).collect();
        assert!(
            !texts.iter().any(|text| text.contains("部位")
                || text.contains("部品")
                || text.contains("市場")
                || *text == "氏名"),
            "compound words leaked as names: {texts:?}"
        );
        assert!(
            !findings.iter().any(|f| f.category == "department"),
            "no department here: {texts:?}"
        );
    }

    #[test]
    fn a_real_department_before_a_particle_or_title_still_matches() {
        let page = page(&[
            "技術開発部の田中が担当する",
            "承認は開発部長が行う",
            "横浜市に拠点がある",
        ]);

        let findings = detect_page(&page, &builtin_rules());

        let departments: Vec<&str> = findings
            .iter()
            .filter(|f| f.category == "department")
            .map(|f| f.text.as_str())
            .collect();
        assert!(departments.contains(&"技術開発部"), "found: {departments:?}");
        assert!(departments.contains(&"開発部"), "found: {departments:?}");
        assert!(
            findings
                .iter()
                .any(|f| f.category == "place" && f.text == "横浜市"),
            "横浜市 should still be a place",
        );
    }

    #[test]
    fn user_search_of_a_department_is_not_suffix_filtered() {
        // A verbatim search must find its term even inside a compound.
        let page = page(&["総務部門の統括"]);
        let rules = vec![RegexRule::literal("search", "総務部")];

        let findings = detect_page(&page, &rules);

        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].text, "総務部");
    }

    #[test]
    fn dictionary_rule_reports_its_own_category_and_detector() {
        let page = page(&["納入元はベータ電子です"]);
        let rules = vec![RegexRule::dictionary("organization", "ベータ電子")];

        let findings = detect_page(&page, &rules);

        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].category, "organization");
        assert_eq!(findings[0].detector, "dictionary");
    }

    #[test]
    fn parenthesized_area_codes_are_detected_in_full() {
        let page = page(&[
            "TEL: (052)72-3359",
            "FAX: （052）73ー0072",
            "本社 03(1234)5678 まで",
        ]);

        let findings = detect_page(&page, &builtin_rules());

        let phones: Vec<&str> = findings
            .iter()
            .filter(|finding| finding.category == "phone")
            .map(|finding| finding.text.as_str())
            .collect();
        assert!(phones.contains(&"(052)72-3359"), "found: {phones:?}");
        assert!(phones.contains(&"（052）73ー0072"), "found: {phones:?}");
        assert!(phones.contains(&"03(1234)5678"), "found: {phones:?}");
    }

    #[test]
    fn ocr_confused_dashes_and_lost_colons_still_match() {
        let page = page(&[
            "電話 045ー123ー4567 まで",
            "参照 https //intra.example.co.jp/results",
        ]);

        let findings = detect_page(&page, &builtin_rules());

        let categories: Vec<&str> = findings
            .iter()
            .map(|finding| finding.category.as_str())
            .collect();
        assert!(categories.contains(&"phone"), "found: {categories:?}");
        assert!(categories.contains(&"url"), "found: {categories:?}");
    }

    fn page_with_line_at(body: &str, footer: &str, footer_y: f32) -> PageOcr {
        let make_line = |text: &str, y: f32| OcrLine {
            text: text.to_string(),
            words: vec![Span {
                text: text.to_string(),
                rect: Rect {
                    x: 100.0,
                    y,
                    width: 300.0,
                    height: 20.0,
                },
            }],
        };
        PageOcr {
            width: 1000,
            height: 1000,
            lines: vec![make_line(body, 400.0), make_line(footer, footer_y)],
        }
    }

    #[test]
    fn repeated_footer_with_page_numbers_is_flagged_on_every_page() {
        let pages = vec![
            page_with_line_at("first page body", "Alpha Corp - Page 1", 950.0),
            page_with_line_at("second page body", "Alpha Corp - Page 2", 950.0),
            page_with_line_at("third page body", "Alpha Corp - Page 3", 950.0),
        ];

        let findings = detect_repeated_lines(&pages);

        assert_eq!(findings.len(), 3);
        for (index, page_findings) in findings.iter().enumerate() {
            assert_eq!(page_findings.len(), 1, "page {index}");
            assert_eq!(page_findings[0].category, "footer");
            assert_eq!(page_findings[0].detector, "layout");
        }
        assert_eq!(findings[1][0].text, "Alpha Corp - Page 2");
    }

    #[test]
    fn repeated_top_line_is_a_header_candidate() {
        let pages = vec![
            page_with_line_at("body one", "CONFIDENTIAL", 50.0),
            page_with_line_at("body two", "CONFIDENTIAL", 50.0),
        ];

        let findings = detect_repeated_lines(&pages);

        assert_eq!(findings[0][0].category, "header");
        assert_eq!(findings[1][0].category, "header");
    }

    #[test]
    fn unique_lines_are_not_flagged() {
        let pages = vec![
            page_with_line_at("body one", "note alpha", 950.0),
            page_with_line_at("body two", "note beta", 950.0),
        ];

        let findings = detect_repeated_lines(&pages);

        assert!(findings.iter().all(|page| page.is_empty()));
    }
}
