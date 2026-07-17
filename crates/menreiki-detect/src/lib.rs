//! Rule-based detection over OCR results.
//!
//! Scans recognized text lines with regular expressions and maps each match
//! back to page coordinates through the word boxes that overlap it, so a
//! finding always knows both what was written and where it sits.

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
}

/// Built-in rules for mechanically detectable identifiers.
pub fn builtin_rules() -> Vec<RegexRule> {
    [
        ("email", r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
        ("url", r"https?://[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+"),
        ("ip-address", r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),
        ("phone", r"\b0\d{1,4}-\d{1,4}-\d{4}\b"),
        ("postal-code", r"(?:〒\s?)?\b\d{3}-\d{4}\b"),
        (
            "date",
            r"\d{4}\s?年\s?\d{1,2}\s?月\s?\d{1,2}\s?日|\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b",
        ),
    ]
    .into_iter()
    .map(|(category, pattern)| {
        RegexRule::new(category, pattern).expect("built-in pattern is valid")
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
}
