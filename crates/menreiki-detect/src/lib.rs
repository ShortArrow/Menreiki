//! Rule-based detection engine over OCR results.
//!
//! Scans recognized text lines with regular expressions and maps each match
//! back to page coordinates through the word boxes that overlap it, so a
//! finding always knows both what was written and where it sits.
//!
//! This crate is language-agnostic: it applies whatever [`RegexRule`]s it is
//! given and knows nothing about any particular language's names. The rules
//! themselves — company forms, honorifics, OCR-confusable folding — live in a
//! language pack such as `menreiki-lang-ja`.

use std::collections::{HashMap, HashSet};
use std::ops::Range;

use menreiki_core::{Finding, PageOcr, Rect, Span};
use regex::Regex;

/// A post-match check a rule can carry: given the matched text and the
/// character immediately following it (if any), decides whether to keep the
/// match. Language packs use this to reject e.g. a name suffix that is really
/// part of a compound word; the engine just applies it.
pub type PostFilter = fn(matched: &str, following: Option<char>) -> bool;

/// A detection rule: text matching `pattern` is reported as `category`,
/// attributed to `detector` ("regex", "dictionary", …). An optional
/// `post_filter` lets a language pack reject spurious matches.
pub struct RegexRule {
    category: String,
    detector: String,
    pattern: Regex,
    post_filter: Option<PostFilter>,
}

impl RegexRule {
    pub fn new(category: &str, pattern: &str) -> Result<Self, regex::Error> {
        Ok(Self {
            category: category.to_string(),
            detector: "regex".to_string(),
            pattern: Regex::new(pattern)?,
            post_filter: None,
        })
    }

    /// Overrides the detector attribution (e.g. "dictionary").
    pub fn with_detector(mut self, detector: &str) -> Self {
        self.detector = detector.to_string();
        self
    }

    /// Attaches a post-match check (see [`PostFilter`]).
    pub fn with_post_filter(mut self, post_filter: PostFilter) -> Self {
        self.post_filter = Some(post_filter);
        self
    }
}

/// Applies every rule to every recognized line of a page.
pub fn detect_page(page: &PageOcr, rules: &[RegexRule]) -> Vec<Finding> {
    let mut findings = Vec::new();
    for line in &page.lines {
        let words = locate_words(&line.text, &line.words);
        let line_rect = union_rects(words.iter().map(|(_, rect)| *rect));
        for rule in rules {
            for matched in rule.pattern.find_iter(&line.text) {
                if let Some(post_filter) = rule.post_filter {
                    let following = line.text[matched.end()..].chars().next();
                    if !post_filter(matched.as_str(), following) {
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

    fn footer_page(body: &str, footer: &str, footer_y: f32) -> PageOcr {
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
    fn a_match_is_mapped_to_its_word_box() {
        let page = page(&["Contact: taro@example.com today"]);
        let rules = vec![
            RegexRule::new("email", r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}").unwrap(),
        ];

        let findings = detect_page(&page, &rules);

        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].text, "taro@example.com");
        assert_eq!(findings[0].detector, "regex");
        assert_eq!(findings[0].rect, page.lines[0].words[1].rect);
    }

    #[test]
    fn a_match_spanning_words_unions_their_rects() {
        let page = page(&["reach admin @example.com"]);
        let rules = vec![RegexRule::new("email-like", r"admin @example\.com").unwrap()];

        let findings = detect_page(&page, &rules);

        assert_eq!(findings.len(), 1);
        let second = &page.lines[0].words[1].rect;
        let third = &page.lines[0].words[2].rect;
        assert_eq!(findings[0].rect, second.union(third));
    }

    #[test]
    fn with_detector_attributes_the_source() {
        let page = page(&["alpha"]);
        let rules = vec![RegexRule::new("term", "alpha")
            .unwrap()
            .with_detector("dictionary")];

        let findings = detect_page(&page, &rules);

        assert_eq!(findings[0].detector, "dictionary");
    }

    #[test]
    fn a_post_filter_can_reject_a_match_by_its_following_char() {
        // Keep "部" only when not followed by another letter.
        fn keep(_matched: &str, following: Option<char>) -> bool {
            !matches!(following, Some(c) if c.is_alphabetic())
        }
        let page = page(&["ab", "aX"]);
        let rules = vec![RegexRule::new("x", "a").unwrap().with_post_filter(keep)];

        let findings = detect_page(&page, &rules);

        // "ab": 'a' followed by 'b' (alphabetic) -> rejected.
        // "aX": 'a' followed by 'X' (alphabetic) -> rejected too.
        assert!(findings.is_empty(), "{findings:?}");
    }

    #[test]
    fn repeated_footer_with_page_numbers_is_flagged_on_every_page() {
        let pages = vec![
            footer_page("first page body", "Alpha Corp - Page 1", 950.0),
            footer_page("second page body", "Alpha Corp - Page 2", 950.0),
            footer_page("third page body", "Alpha Corp - Page 3", 950.0),
        ];

        let findings = detect_repeated_lines(&pages);

        assert_eq!(findings.len(), 3);
        for page_findings in &findings {
            assert_eq!(page_findings.len(), 1);
            assert_eq!(page_findings[0].category, "footer");
            assert_eq!(page_findings[0].detector, "layout");
        }
    }

    #[test]
    fn repeated_top_line_is_a_header_candidate() {
        let pages = vec![
            footer_page("body one", "CONFIDENTIAL", 50.0),
            footer_page("body two", "CONFIDENTIAL", 50.0),
        ];

        let findings = detect_repeated_lines(&pages);

        assert_eq!(findings[0][0].category, "header");
        assert_eq!(findings[1][0].category, "header");
    }

    #[test]
    fn letter_spaced_repeats_group_despite_spacing_differences() {
        let pages = vec![
            footer_page("body one", "ガ ン マ 電 子 工 業", 950.0),
            footer_page("body two", "ガンマ 電子 工業", 950.0),
        ];

        let findings = detect_repeated_lines(&pages);

        assert_eq!(findings[0].len(), 1);
        assert_eq!(findings[1].len(), 1);
        assert_eq!(findings[0][0].category, "footer");
    }

    #[test]
    fn unique_lines_are_not_flagged() {
        let pages = vec![
            footer_page("body one", "note alpha", 950.0),
            footer_page("body two", "note beta", 950.0),
        ];

        let findings = detect_repeated_lines(&pages);

        assert!(findings.iter().all(|page| page.is_empty()));
    }
}
