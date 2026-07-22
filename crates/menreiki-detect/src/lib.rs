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

/// A named, single-purpose set of rules that can be toggled as a unit and
/// composed with other groups. The `id` is the stable selection handle
/// (e.g. "phone-jp"); it is independent of the finding categories the rules
/// emit, so two groups ("phone-jp", "phone-intl") can both report "phone".
pub struct DetectorGroup {
    id: String,
    rules: Vec<RegexRule>,
}

impl DetectorGroup {
    pub fn new(id: &str, rules: Vec<RegexRule>) -> Self {
        Self {
            id: id.to_string(),
            rules,
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }
}

/// A composition of detector groups from one or more packs.
///
/// Groups are added in order; a group whose id is already present is skipped
/// (first-wins), so packs that each ship a generic detector do not run it
/// twice. To override a group, add your version before the pack that also
/// defines it. `without` drops groups by id — the mechanism behind per-user
/// detector on/off.
#[derive(Default)]
pub struct DetectorSet {
    groups: Vec<DetectorGroup>,
    seen: HashSet<String>,
}

impl DetectorSet {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn extend(mut self, groups: impl IntoIterator<Item = DetectorGroup>) -> Self {
        for group in groups {
            if self.seen.insert(group.id.clone()) {
                self.groups.push(group);
            }
        }
        self
    }

    pub fn without(mut self, disabled: &[String]) -> Self {
        self.groups
            .retain(|group| !disabled.iter().any(|d| d == &group.id));
        self.seen = self.groups.iter().map(|group| group.id.clone()).collect();
        self
    }

    /// Keeps only the groups whose id is in `enabled` — the allow-list a
    /// project uses to pin exactly the detectors it needs.
    pub fn only(mut self, enabled: &[String]) -> Self {
        self.groups
            .retain(|group| enabled.iter().any(|e| e == &group.id));
        self.seen = self.groups.iter().map(|group| group.id.clone()).collect();
        self
    }

    /// Ids of the groups currently in the set, in order — for listing the
    /// toggleable detectors in a UI or CLI.
    pub fn ids(&self) -> Vec<&str> {
        self.groups.iter().map(|group| group.id.as_str()).collect()
    }

    /// All rules, flattened, ready for [`detect_page`].
    pub fn into_rules(self) -> Vec<RegexRule> {
        self.groups
            .into_iter()
            .flat_map(|group| group.rules)
            .collect()
    }
}

/// Applies every rule to every recognized line of a page.
///
/// A rule whose pattern defines a named group `keep` reports only that group
/// (text, coordinates, and the following-character check), while the rest of
/// the pattern acts as required context — the way to match "○○と称する" but
/// report just the "○○". Rules without it report the whole match.
pub fn detect_page(page: &PageOcr, rules: &[RegexRule]) -> Vec<Finding> {
    let mut findings = Vec::new();
    for line in &page.lines {
        let words = locate_words(&line.text, &line.words);
        let line_rect = union_rects(words.iter().map(|(_, rect)| *rect));
        for rule in rules {
            for captures in rule.pattern.captures_iter(&line.text) {
                let Some(reported) = captures
                    .name("keep")
                    .or_else(|| captures.get(0))
                else {
                    continue;
                };
                if let Some(post_filter) = rule.post_filter {
                    let following = line.text[reported.end()..].chars().next();
                    if !post_filter(reported.as_str(), following) {
                        continue;
                    }
                }
                let rect = rect_for_range(reported.range(), &words)
                    .or(line_rect)
                    .unwrap_or(EMPTY_RECT);
                // Drop rects that can only be word-mapping artifacts: a span
                // covering most of the page, or a box far wider than its text
                // needs (a thin band stretched along an arrow in a diagram).
                if covers_most_of_page(&rect, page)
                    || rect_too_wide_for_text(&rect, reported.as_str())
                {
                    continue;
                }
                findings.push(Finding {
                    category: rule.category.clone(),
                    text: reported.as_str().to_string(),
                    rect,
                    detector: rule.detector.clone(),
                    note: None,
                });
            }
        }
    }
    findings
}

/// Whether `rect` covers so much of the page that it can only be a mis-mapped
/// span (e.g. a whole-page tint), not a genuine text finding.
fn covers_most_of_page(rect: &Rect, page: &PageOcr) -> bool {
    let page_area = page.width as f32 * page.height as f32;
    page_area > 0.0 && rect.width * rect.height > page_area * 0.5
}

/// Whether `rect` is far wider than `text` could fill. Windows OCR returns CJK
/// as one tight box per character (~as wide as tall), so N characters need
/// ~N×height; even letter-spaced names stay within a few times that. A box
/// many times wider is a word-mapping artifact — a box's text unioned with a
/// distant word along a diagram connector. Long findings (URLs) scale their
/// width with their length, so they are unaffected.
fn rect_too_wide_for_text(rect: &Rect, text: &str) -> bool {
    let chars = text.chars().filter(|c| !c.is_whitespace()).count() as f32;
    chars > 0.0 && rect.height > 0.0 && rect.width > chars * rect.height * 6.0
}

/// Whether `text` is page-numbering boilerplate (only digits and separators,
/// e.g. "30 / 37" or "- 5 -"): repeated on every page but never sensitive, so
/// it should not clutter the candidate list.
fn is_numeric_boilerplate(text: &str) -> bool {
    let mut has_digit = false;
    for character in text.chars() {
        if character.is_ascii_digit() {
            has_digit = true;
        } else if !character.is_whitespace()
            && !matches!(
                character,
                '/' | '-' | '.' | ',' | '#' | '|' | '(' | ')' | ':' | '－' | '―' | '／' | '～'
            )
        {
            return false;
        }
    }
    has_digit
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
            if covers_most_of_page(&rect, &pages[page_index]) || is_numeric_boilerplate(&text) {
                continue;
            }
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
    fn a_match_covering_most_of_the_page_is_dropped() {
        // Two words that (mis)map to opposite corners would union into a
        // page-spanning rect — the whole-page-tint bug. Drop it.
        let page = PageOcr {
            width: 1000,
            height: 1000,
            lines: vec![OcrLine {
                text: "aX".to_string(),
                words: vec![
                    Span {
                        text: "a".to_string(),
                        rect: Rect { x: 0.0, y: 0.0, width: 10.0, height: 10.0 },
                    },
                    Span {
                        text: "X".to_string(),
                        rect: Rect { x: 0.0, y: 990.0, width: 1000.0, height: 10.0 },
                    },
                ],
            }],
        };
        // Pattern matches across both words, so the rect unions to full-page.
        let rules = vec![RegexRule::new("x", "aX").unwrap()];

        assert!(detect_page(&page, &rules).is_empty());
    }

    #[test]
    fn a_match_far_wider_than_its_text_is_dropped() {
        // "abcd" mapped to a box far wider than four characters need (stretched
        // along a diagram arrow). Drop it.
        let page = PageOcr {
            width: 1000,
            height: 1000,
            lines: vec![OcrLine {
                text: "abcd".to_string(),
                words: vec![Span {
                    text: "abcd".to_string(),
                    rect: Rect { x: 0.0, y: 500.0, width: 900.0, height: 20.0 },
                }],
            }],
        };
        let rules = vec![RegexRule::new("x", "abcd").unwrap()];

        assert!(detect_page(&page, &rules).is_empty());
    }

    #[test]
    fn page_numbers_are_not_repeated_line_candidates() {
        let make = |text: &str| PageOcr {
            width: 1000,
            height: 1000,
            lines: vec![OcrLine {
                text: text.to_string(),
                words: vec![Span {
                    text: text.to_string(),
                    rect: Rect { x: 450.0, y: 960.0, width: 100.0, height: 20.0 },
                }],
            }],
        };
        let pages = vec![make("30 / 37"), make("31 / 37"), make("32 / 37")];

        let findings = detect_repeated_lines(&pages);

        assert!(
            findings.iter().all(|page| page.is_empty()),
            "page-number footers leaked as candidates: {findings:?}"
        );
    }

    #[test]
    fn a_keep_group_reports_only_that_span() {
        // Match "○○と称す" for context but report just the "○○".
        let page = page(&["以下アルファ商事と称する"]);
        let rules =
            vec![RegexRule::new("organization", r"(?P<keep>[アルファ商事]+)と称").unwrap()];

        let findings = detect_page(&page, &rules);

        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].text, "アルファ商事");
    }

    fn group(id: &str, pattern: &str) -> DetectorGroup {
        DetectorGroup::new(id, vec![RegexRule::new(id, pattern).unwrap()])
    }

    #[test]
    fn detector_set_composes_and_flattens_groups() {
        let set = DetectorSet::new()
            .extend([group("a", "x")])
            .extend([group("b", "y")]);

        assert_eq!(set.ids(), vec!["a", "b"]);
        assert_eq!(set.into_rules().len(), 2);
    }

    #[test]
    fn duplicate_group_ids_are_skipped_first_wins() {
        let page = page(&["z"]);
        // Two packs both ship a "dup" group; the first-added one wins.
        let set = DetectorSet::new()
            .extend([DetectorGroup::new(
                "dup",
                vec![RegexRule::new("first", "z").unwrap()],
            )])
            .extend([DetectorGroup::new(
                "dup",
                vec![RegexRule::new("second", "z").unwrap()],
            )]);

        assert_eq!(set.ids(), vec!["dup"]);
        let findings = detect_page(&page, &set.into_rules());
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].category, "first");
    }

    #[test]
    fn without_drops_groups_by_id() {
        let set = DetectorSet::new()
            .extend([group("a", "x"), group("b", "y"), group("c", "z")])
            .without(&["b".to_string()]);

        assert_eq!(set.ids(), vec!["a", "c"]);
    }

    #[test]
    fn only_keeps_the_allow_listed_groups() {
        let set = DetectorSet::new()
            .extend([group("a", "x"), group("b", "y"), group("c", "z")])
            .only(&["c".to_string(), "a".to_string()]);

        assert_eq!(set.ids(), vec!["a", "c"]);
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
