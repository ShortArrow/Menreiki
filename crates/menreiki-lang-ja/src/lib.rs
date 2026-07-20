//! Japanese detection rules for the Menreiki detection engine.
//!
//! Holds everything language-specific that `menreiki-detect` deliberately
//! does not know: company legal forms, department/person/place suffixes,
//! Japanese phone and postal formats, and the OCR-confusable folding
//! (hiragana/katakana homoglyphs, dash variants, letter spacing) used when
//! matching a user-supplied string. A future `menreiki-lang-en` can plug
//! into the same engine without touching it.

use menreiki_detect::{DetectorGroup, DetectorSet, RegexRule};

/// Japanese detector groups: the name heuristics (organization, department,
/// person, place) and the Japan-local formats (0-prefixed domestic phone,
/// 〒 postal codes, Japanese-era dates). Email, URL, IP, MAC, and
/// international (+CC) phone numbers are locale-independent and come from the
/// universal pack via [`preset`].
///
/// The name heuristics deliberately over-trigger — findings are candidates
/// for human review, and a missed name costs more than a rejected candidate.
pub fn groups() -> Vec<DetectorGroup> {
    let forms = legal_forms();
    let heuristics = [
        (
            "organization",
            "organization",
            format!(
                "(?:{forms})(?:\\s*{ORG_CHAR}){{1,20}}\
                 |(?:{ORG_CHAR}\\s*){{1,20}}(?:{forms})\
                 |(?:{ORG_CHAR}\\s*){{2,20}}(?:グループ|ホールディングス)"
            ),
        ),
        (
            "department",
            "department",
            format!(
                "(?:{ORG_CHAR}\\s*){{1,20}}(?:部門|事業部|本部|支社|支店|営業所|研究所|製作所)\
                 |(?:{ORG_CHAR}\\s*){{2,20}}[部課係]"
            ),
        ),
        (
            "person",
            "person",
            format!("(?:{ORG_CHAR}\\s*){{1,4}}(?:氏|殿|さん)"),
        ),
        (
            "place",
            "place",
            format!("(?:{ORG_CHAR}\\s*){{1,6}}[都府県市区町村]|北\\s*海\\s*道"),
        ),
    ]
    .into_iter()
    .map(|(id, category, pattern)| {
        DetectorGroup::new(
            id,
            vec![RegexRule::new(category, &pattern)
                .expect("built-in pattern is valid")
                .with_post_filter(heuristic_keep)],
        )
    });

    let japan_local = [
        (
            "phone-jp",
            "phone",
            format!(
                r"[（(]0\d{{1,4}}[)）]\s?\d{{1,4}}[{DASH_CHARS}]\d{{4}}\b|\b0\d{{1,4}}[（(]\d{{1,4}}[)）]\d{{4}}\b|\b0\d{{1,4}}[{DASH_CHARS}]\d{{1,4}}[{DASH_CHARS}]\d{{4}}\b"
            ),
        ),
        (
            "postal-code",
            "postal-code",
            format!(r"(?:〒\s?)?\b\d{{3}}[{DASH_CHARS}]\d{{4}}\b"),
        ),
        (
            "date",
            "date",
            r"\d{4}\s?年\s?\d{1,2}\s?月\s?\d{1,2}\s?日|\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b"
                .to_string(),
        ),
    ]
    .into_iter()
    .map(|(id, category, pattern)| {
        DetectorGroup::new(
            id,
            vec![RegexRule::new(category, &pattern).expect("built-in pattern is valid")],
        )
    });

    heuristics.chain(japan_local).collect()
}

/// The default detector composition for Japanese documents: the Japanese
/// groups plus the universal groups, deduplicated by id. Callers apply
/// [`DetectorSet::without`] to disable individual groups.
pub fn preset() -> DetectorSet {
    DetectorSet::new()
        .extend(groups())
        .extend(menreiki_detect_universal::groups())
}

/// The preset's rules, flattened — the "everything on" convenience for
/// callers that do not need group-level selection.
pub fn builtin_rules() -> Vec<RegexRule> {
    preset().into_rules()
}

/// A rule matching `text` the way OCR may have read it — the path for
/// user-supplied strings (search, dictionaries, policy text rules, audit
/// deny terms).
///
/// Tolerated OCR variations, applied per character of the term:
/// - spurious whitespace (CJK engines split lines into one-character words,
///   scattering spaces)
/// - hiragana/katakana homoglyphs (ベ read as べ)
/// - dash-like character confusions (- read as ー)
pub fn literal_rule(category: &str, text: &str) -> RegexRule {
    let pattern = text
        .chars()
        .filter(|character| !character.is_whitespace())
        .map(confusable_class)
        .collect::<Vec<_>>()
        .join(r"\s*");
    RegexRule::new(category, &pattern).expect("escaped literal is a valid pattern")
}

/// A user-dictionary rule: matches `text` with the same OCR tolerance as
/// [`literal_rule`], reported under the entry's own category and attributed
/// to the dictionary.
pub fn dictionary_rule(category: &str, text: &str) -> RegexRule {
    literal_rule(category, text).with_detector("dictionary")
}

/// Characters that may appear inside a Japanese name. Covers CJK ideographs
/// including Extension A and the compatibility block (so surname variants
/// such as 﨑 U+FA11 do not split a name), the iteration mark 々, katakana,
/// and Latin/digits. Hiragana is excluded on purpose: it terminates the name
/// so surrounding particles (「〜した」「〜から」) never leak into the match.
const ORG_CHAR: &str = r"[\u{3005}\u{3400}-\u{9FFF}\u{F900}-\u{FAFF}ァ-ヶーA-Za-z0-9]";

/// Dash-like characters OCR commonly confuses with each other, e.g. the
/// katakana prolonged sound mark read from a hyphen in "045-123-4567".
const DASH_CHARS: &str = "-‐‑–—−ー";

/// Words a name-suffix heuristic would otherwise flag (都市, 政府, 彼氏…);
/// candidates matching one of these exactly are dropped.
const HEURISTIC_STOPWORDS: [&str; 7] =
    ["都市", "首都", "政府", "地区", "彼氏", "摂氏", "華氏"];

/// Single-character name suffixes that are only meaningful at a word
/// boundary: 技術開発部 is a department, but 部 inside 部位 / 部品 is not, and
/// 市 inside 市場 is not a place.
const BOUNDARY_SUFFIXES: &str = "部課係都府県市区町村氏殿";

/// Post-filter for the name heuristics: drop exact stopwords, and drop a
/// match ending in a boundary suffix when another ideograph follows it
/// (部位, 部品, 市場, 氏名) — 長 excepted, since it marks a title on a real
/// unit (営業部長 → 営業部).
fn heuristic_keep(matched: &str, following: Option<char>) -> bool {
    if HEURISTIC_STOPWORDS.contains(&matched) {
        return false;
    }
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

/// A regex fragment matching `character` and everything OCR plausibly
/// confuses it with (hiragana/katakana homoglyphs, dash variants).
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

#[cfg(test)]
mod tests {
    use super::*;
    use menreiki_core::{OcrLine, PageOcr, Rect, Span};
    use menreiki_detect::detect_page;

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

    fn by_category<'a>(findings: &'a [menreiki_core::Finding], category: &str) -> Vec<&'a str> {
        findings
            .iter()
            .filter(|finding| finding.category == category)
            .map(|finding| finding.text.as_str())
            .collect()
    }

    #[test]
    fn finds_mechanical_identifiers_across_lines() {
        let page = page(&[
            "tel: 03-1234-5678",
            "server 192.168.10.21 at https://example.com/path",
            "納期 2026年7月17日",
            "Contact: taro@example.com",
        ]);

        let findings = detect_page(&page, &builtin_rules());

        let categories: Vec<&str> = findings.iter().map(|f| f.category.as_str()).collect();
        for expected in ["phone", "ip-address", "url", "date", "email"] {
            assert!(categories.contains(&expected), "missing {expected}: {categories:?}");
        }
    }

    #[test]
    fn company_names_are_flagged_as_organization_candidates() {
        let page = page(&[
            "本書は、株式会社ベータ電機から受領した",
            "納入元はベータ電子株式会社とする",
            "担当は 株 式 会 社 アルファ技研 のもの",
        ]);

        let findings = detect_page(&page, &builtin_rules());
        let orgs = by_category(&findings, "organization");

        assert!(orgs.contains(&"株式会社ベータ電機"), "found: {orgs:?}");
        assert!(orgs.contains(&"ベータ電子株式会社"), "found: {orgs:?}");
        assert!(orgs.iter().any(|t| t.contains("アルファ技研")), "found: {orgs:?}");
    }

    #[test]
    fn company_name_stays_whole_across_variant_kanji_and_ocr_gaps() {
        let page = page(&[
            "取引先は猫﨑電気産業株式会社である",
            "検収は猫崎  電気産業株式会社が行う",
        ]);

        let findings = detect_page(&page, &builtin_rules());
        let orgs = by_category(&findings, "organization");

        assert!(
            orgs.iter().any(|t| t.starts_with("猫﨑") && t.ends_with("株式会社")),
            "variant kanji split the name: {orgs:?}"
        );
        assert!(
            orgs.iter().any(|t| t.starts_with("猫崎") && t.ends_with("株式会社")),
            "an OCR gap split the name: {orgs:?}"
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

        assert!(by_category(&findings, "department").contains(&"技術開発部"));
        assert!(by_category(&findings, "department").contains(&"第二営業課"));
        assert!(by_category(&findings, "person").contains(&"田中氏"));
        assert!(by_category(&findings, "person").contains(&"佐藤さん"));
        assert!(by_category(&findings, "organization").contains(&"アルファグループ"));
        assert!(by_category(&findings, "place").contains(&"横浜市"));
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
            !texts.iter().any(|t| t.contains("部位")
                || t.contains("部品")
                || t.contains("市場")
                || *t == "氏名"),
            "compound words leaked as names: {texts:?}"
        );
        assert!(!findings.iter().any(|f| f.category == "department"));
    }

    #[test]
    fn a_real_department_before_a_particle_or_title_still_matches() {
        let page = page(&[
            "技術開発部の田中が担当する",
            "承認は開発部長が行う",
            "横浜市に拠点がある",
        ]);
        let findings = detect_page(&page, &builtin_rules());

        let departments = by_category(&findings, "department");
        assert!(departments.contains(&"技術開発部"), "found: {departments:?}");
        assert!(departments.contains(&"開発部"), "found: {departments:?}");
        assert!(by_category(&findings, "place").contains(&"横浜市"));
    }

    #[test]
    fn heuristic_stopwords_are_not_flagged() {
        let page = page(&["都市計画は政府と地区の方針による"]);

        assert!(detect_page(&page, &builtin_rules()).is_empty());
    }

    #[test]
    fn parenthesized_area_codes_are_detected_in_full() {
        let page = page(&[
            "TEL: (052)72-3359",
            "FAX: （052）73ー0072",
            "本社 03(1234)5678 まで",
        ]);
        let findings = detect_page(&page, &builtin_rules());
        let phones = by_category(&findings, "phone");

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

        assert!(findings.iter().any(|f| f.category == "phone"), "{findings:?}");
        assert!(findings.iter().any(|f| f.category == "url"), "{findings:?}");
    }

    #[test]
    fn literal_rule_matches_verbatim_including_regex_metacharacters() {
        let page = page(&["order (A+B) confirmed"]);
        let findings = detect_page(&page, &[literal_rule("order-code", "(A+B)")]);

        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].text, "(A+B)");
    }

    #[test]
    fn literal_rule_tolerates_ocr_spacing_and_kana_homoglyphs() {
        let spaced = page(&["宛先 株式会社アル フ ァ技研 御中"]);
        let findings = detect_page(&spaced, &[literal_rule("organization", "株式会社アルファ技研")]);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].text, "株式会社アル フ ァ技研");

        let kana = page(&["発注先は株式会社べータ電機とする"]);
        let findings = detect_page(&kana, &[literal_rule("organization", "株式会社ベータ電機")]);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].text, "株式会社べータ電機");
    }

    #[test]
    fn user_search_of_a_department_is_not_suffix_filtered() {
        let page = page(&["総務部門の統括"]);
        let findings = detect_page(&page, &[literal_rule("search", "総務部")]);

        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].text, "総務部");
    }

    #[test]
    fn dictionary_rule_reports_its_own_category_and_detector() {
        let page = page(&["納入元はベータ電子です"]);
        let findings = detect_page(&page, &[dictionary_rule("organization", "ベータ電子")]);

        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].category, "organization");
        assert_eq!(findings[0].detector, "dictionary");
    }
}
