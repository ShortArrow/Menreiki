use serde::{Deserialize, Serialize};

use crate::geometry::Rect;

/// One recognized word and where it sits on the page image.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Span {
    pub text: String,
    pub rect: Rect,
}

/// One recognized text line in reading order.
///
/// `text` is stored, not rebuilt from `words`, because word joining is
/// engine- and language-dependent; adapters should compose it with
/// [`compose_line_text`] unless the engine's own line text is trustworthy.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OcrLine {
    pub text: String,
    pub words: Vec<Span>,
}

/// Joins recognized words into line text, inserting a space only where the
/// horizontal gap between neighboring word boxes looks like a real space.
///
/// OCR engines that split CJK lines into one-character words (Windows OCR
/// does) would otherwise scatter spaces through Japanese text and break
/// every downstream string match.
pub fn compose_line_text(words: &[Span]) -> String {
    let mut text = String::new();
    let mut previous: Option<&Span> = None;
    for word in words {
        if let Some(previous) = previous {
            let gap = word.rect.x - (previous.rect.x + previous.rect.width);
            let reference = previous.rect.height.max(word.rect.height);
            if gap > reference * 0.33 {
                text.push(' ');
            }
        }
        text.push_str(&word.text);
        previous = Some(word);
    }
    text
}

/// Rejoins OCR lines that are really one horizontal line split into pieces —
/// the way an engine fragments widely letter-spaced text (e.g. a company name
/// in a title block: 「犬 芝 工 業 株 式 会 社」 becoming one line per
/// character). Two lines merge only when they sit on the same row (their
/// vertical extents overlap) and are horizontally close, so stacked box text
/// (two centered lines) and separate labels or columns stay apart.
pub fn merge_row_fragments(page: &PageOcr) -> PageOcr {
    let mut entries: Vec<(Rect, &OcrLine)> = page
        .lines
        .iter()
        .filter_map(|line| line_bounds(line).map(|rect| (rect, line)))
        .collect();
    entries.sort_by(|a, b| {
        let (ay, by) = (a.0.y + a.0.height / 2.0, b.0.y + b.0.height / 2.0);
        ay.partial_cmp(&by)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(
                a.0.x
                    .partial_cmp(&b.0.x)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
    });

    let mut groups: Vec<Vec<&OcrLine>> = Vec::new();
    let mut row: Option<Rect> = None;
    for (rect, line) in entries {
        if let Some(current) = row {
            let shared = vertical_overlap(&current, &rect);
            let ratio = shared / current.height.min(rect.height).max(1.0);
            let gap = rect.x - (current.x + current.width);
            let threshold = current.height.max(rect.height) * 2.0;
            if ratio > 0.5 && gap < threshold {
                groups.last_mut().expect("row has a group").push(line);
                row = Some(current.union(&rect));
                continue;
            }
        }
        groups.push(vec![line]);
        row = Some(rect);
    }

    let lines = groups
        .into_iter()
        .map(|group| {
            if group.len() == 1 {
                return group[0].clone();
            }
            let mut words: Vec<Span> =
                group.iter().flat_map(|line| line.words.iter().cloned()).collect();
            words.sort_by(|a, b| {
                a.rect
                    .x
                    .partial_cmp(&b.rect.x)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            OcrLine {
                text: compose_line_text(&words),
                words,
            }
        })
        .collect();
    PageOcr {
        width: page.width,
        height: page.height,
        lines,
    }
}

fn line_bounds(line: &OcrLine) -> Option<Rect> {
    let mut words = line.words.iter();
    let first = words.next()?.rect;
    Some(words.fold(first, |bounds, word| bounds.union(&word.rect)))
}

fn vertical_overlap(a: &Rect, b: &Rect) -> f32 {
    let top = a.y.max(b.y);
    let bottom = (a.y + a.height).min(b.y + b.height);
    (bottom - top).max(0.0)
}

/// OCR result for a single page image, in that image's pixel coordinates.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct PageOcr {
    pub width: u32,
    pub height: u32,
    pub lines: Vec<OcrLine>,
}

impl PageOcr {
    /// Reconstructs the page's plain text, one recognized line per text line.
    pub fn text(&self) -> String {
        self.lines
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn span(text: &str) -> Span {
        Span {
            text: text.to_string(),
            rect: Rect {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
        }
    }

    #[test]
    fn reconstructs_text_line_by_line() {
        let page = PageOcr {
            width: 100,
            height: 100,
            lines: vec![
                OcrLine {
                    text: "first line".to_string(),
                    words: vec![span("first"), span("line")],
                },
                OcrLine {
                    text: "第二行".to_string(),
                    words: vec![span("第"), span("二"), span("行")],
                },
            ],
        };

        assert_eq!(page.text(), "first line\n第二行");
    }

    #[test]
    fn empty_page_yields_empty_text() {
        assert_eq!(PageOcr::default().text(), "");
    }

    fn word_at(text: &str, x: f32, width: f32) -> Span {
        Span {
            text: text.to_string(),
            rect: Rect {
                x,
                y: 0.0,
                width,
                height: 20.0,
            },
        }
    }

    #[test]
    fn tightly_packed_cjk_characters_join_without_spaces() {
        let words = [
            word_at("株", 0.0, 20.0),
            word_at("式", 22.0, 20.0),
            word_at("会", 44.0, 20.0),
            word_at("社", 66.0, 20.0),
        ];

        assert_eq!(compose_line_text(&words), "株式会社");
    }

    #[test]
    fn a_wide_gap_becomes_a_space() {
        let words = [
            word_at("アルファ", 0.0, 80.0),
            word_at("御中", 95.0, 40.0),
        ];

        assert_eq!(compose_line_text(&words), "アルファ 御中");
    }

    fn char_line(text: &str, x: f32, y: f32) -> OcrLine {
        OcrLine {
            text: text.to_string(),
            words: vec![Span {
                text: text.to_string(),
                rect: Rect {
                    x,
                    y,
                    width: 20.0,
                    height: 20.0,
                },
            }],
        }
    }

    #[test]
    fn merges_letter_spaced_fragments_on_one_row() {
        // Each character came back as its own line, all on the same row.
        let page = PageOcr {
            width: 400,
            height: 100,
            lines: vec![
                char_line("犬", 0.0, 10.0),
                char_line("芝", 40.0, 10.0),
                char_line("工", 80.0, 10.0),
                char_line("業", 120.0, 10.0),
            ],
        };

        let merged = merge_row_fragments(&page);

        assert_eq!(merged.lines.len(), 1);
        assert_eq!(merged.lines[0].text.replace(' ', ""), "犬芝工業");
    }

    #[test]
    fn keeps_stacked_box_lines_separate() {
        // A centered two-line box: different rows must not merge.
        let page = PageOcr {
            width: 400,
            height: 200,
            lines: vec![
                char_line("操舵指令", 60.0, 10.0),
                char_line("受信部", 75.0, 40.0),
            ],
        };

        let merged = merge_row_fragments(&page);

        assert_eq!(merged.lines.len(), 2);
    }

    #[test]
    fn keeps_distant_columns_on_the_same_row_separate() {
        // Same row but far apart (two labels / columns): must not merge.
        let page = PageOcr {
            width: 800,
            height: 100,
            lines: vec![
                char_line("操舵指令", 0.0, 10.0),
                char_line("赤外線画像", 400.0, 10.0),
            ],
        };

        let merged = merge_row_fragments(&page);

        assert_eq!(merged.lines.len(), 2);
    }
}
