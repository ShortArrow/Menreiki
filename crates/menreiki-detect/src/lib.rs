//! Rule-based detection over OCR results.
//!
//! Scans recognized text lines with regular expressions and maps each match
//! back to page coordinates through the word boxes that overlap it, so a
//! finding always knows both what was written and where it sits.

use std::collections::{HashMap, HashSet};
use std::ops::Range;

use menreiki_core::{Finding, PageOcr, Rect, Span};
use regex::Regex;

/// A detection rule: text matching `pattern` is reported as `category`.
pub struct RegexRule {
    category: String,
    pattern: Regex,
}

impl RegexRule {
    pub fn new(category: &str, pattern: &str) -> Result<Self, regex::Error> {
        Ok(Self {
            category: category.to_string(),
            pattern: Regex::new(pattern)?,
        })
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

/// Built-in rules for mechanically detectable identifiers. Patterns accept
/// common OCR confusions (dash variants, a lost colon in URLs) so that a
/// recognizable identifier is still flagged.
pub fn builtin_rules() -> Vec<RegexRule> {
    [
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
    })
    .collect()
}

/// Applies every rule to every recognized line of a page.
pub fn detect_page(page: &PageOcr, rules: &[RegexRule]) -> Vec<Finding> {
    let mut findings = Vec::new();
    for line in &page.lines {
        let words = locate_words(&line.text, &line.words);
        let line_rect = union_rects(words.iter().map(|(_, rect)| *rect));
        for rule in rules {
            for matched in rule.pattern.find_iter(&line.text) {
                let rect = rect_for_range(matched.range(), &words)
                    .or(line_rect)
                    .unwrap_or(EMPTY_RECT);
                findings.push(Finding {
                    category: rule.category.clone(),
                    text: matched.as_str().to_string(),
                    rect,
                    detector: "regex".to_string(),
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
