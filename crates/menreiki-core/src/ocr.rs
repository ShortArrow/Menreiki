use std::collections::HashMap;

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

/// Rejoins OCR lines that are really one line of text split into pieces — the
/// way an engine fragments widely letter-spaced text (a title-block company
/// name 「犬 芝 工 業 株 式 会 社」 becoming one line per character), whether it
/// runs across the page (horizontal) or, when a horizontal label is rotated
/// 90°, down it (vertical).
///
/// Only runs of *single-character* fragments merge, connecting each to a
/// collinear neighbour that is close in the reading direction. Multi-character
/// lines (a table cell, a label) never merge, so text separated by a ruling
/// line into adjacent cells stays apart. Each run reads in the direction it is
/// most spread — left-to-right for a row, top-to-bottom for a column.
pub fn merge_row_fragments(page: &PageOcr) -> PageOcr {
    let mut lines: Vec<OcrLine> = Vec::new();
    let mut frags: Vec<(Rect, &OcrLine)> = Vec::new();
    for line in &page.lines {
        match line_bounds(line) {
            Some(rect) if is_single_char(line) => frags.push((rect, line)),
            _ => lines.push(line.clone()),
        }
    }

    let mut parent: Vec<usize> = (0..frags.len()).collect();
    for a in 0..frags.len() {
        for b in (a + 1)..frags.len() {
            if collinear_neighbours(&frags[a].0, &frags[b].0) {
                let (ra, rb) = (find_root(&mut parent, a), find_root(&mut parent, b));
                parent[ra] = rb;
            }
        }
    }

    let mut runs: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..frags.len() {
        let root = find_root(&mut parent, i);
        runs.entry(root).or_default().push(i);
    }
    for members in runs.into_values() {
        if members.len() == 1 {
            lines.push(frags[members[0]].1.clone());
            continue;
        }
        let x_spread = spread(members.iter().map(|&i| frags[i].0.x));
        let y_spread = spread(members.iter().map(|&i| frags[i].0.y));
        // A real run is a thin line — spread in one axis, a character thick in
        // the other. A cluster wide in both axes is a grid of cells (a table
        // column of "+28" values), not one word; leave those characters alone.
        let char_size = members
            .iter()
            .map(|&i| frags[i].0.height)
            .fold(0.0_f32, f32::max);
        if x_spread.min(y_spread) > char_size * 1.5 {
            for &i in &members {
                lines.push(frags[i].1.clone());
            }
            continue;
        }
        let horizontal = x_spread >= y_spread;
        let mut ordered = members;
        ordered.sort_by(|&a, &b| {
            let (ra, rb) = (frags[a].0, frags[b].0);
            let (ka, kb) = if horizontal { (ra.x, rb.x) } else { (ra.y, rb.y) };
            ka.partial_cmp(&kb).unwrap_or(std::cmp::Ordering::Equal)
        });
        let words: Vec<Span> = ordered
            .iter()
            .flat_map(|&i| frags[i].1.words.iter().cloned())
            .collect();
        if horizontal {
            lines.push(OcrLine {
                text: compose_line_text(&words),
                words,
            });
        } else {
            // A column reads straight down. Which way a rotated horizontal
            // label reads (top-down for a clockwise turn, bottom-up for a
            // counter-clockwise one) is ambiguous, so emit both orders and let
            // detection keep whichever forms a real name.
            let forward: String = words.iter().map(|word| word.text.as_str()).collect();
            let mut reversed_words = words.clone();
            reversed_words.reverse();
            let reversed: String = reversed_words.iter().map(|word| word.text.as_str()).collect();
            lines.push(OcrLine { text: forward, words });
            lines.push(OcrLine {
                text: reversed,
                words: reversed_words,
            });
        }
    }
    PageOcr {
        width: page.width,
        height: page.height,
        lines,
    }
}

fn is_single_char(line: &OcrLine) -> bool {
    line.text.chars().filter(|c| !c.is_whitespace()).count() == 1
}

fn find_root(parent: &mut [usize], index: usize) -> usize {
    let mut root = index;
    while parent[root] != root {
        root = parent[root];
    }
    let mut current = index;
    while parent[current] != root {
        let next = parent[current];
        parent[current] = root;
        current = next;
    }
    root
}

fn spread(values: impl Iterator<Item = f32>) -> f32 {
    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    for value in values {
        min = min.min(value);
        max = max.max(value);
    }
    (max - min).max(0.0)
}

/// Whether two single-character boxes are neighbours in a run: on the same row
/// and horizontally close, or in the same column and vertically close. The
/// gap allowance is a couple of glyph sizes — enough for wide letter-spacing,
/// but not a jump to the next label.
fn collinear_neighbours(a: &Rect, b: &Rect) -> bool {
    let row = vertical_overlap(a, b) / a.height.min(b.height).max(1.0) > 0.5;
    let h_gap = (b.x - (a.x + a.width)).max(a.x - (b.x + b.width));
    if row && h_gap < a.height.max(b.height) * 2.0 {
        return true;
    }
    let column = horizontal_overlap(a, b) / a.width.min(b.width).max(1.0) > 0.5;
    let v_gap = (b.y - (a.y + a.height)).max(a.y - (b.y + b.height));
    column && v_gap < a.width.max(b.width) * 2.0
}

fn horizontal_overlap(a: &Rect, b: &Rect) -> f32 {
    let left = a.x.max(b.x);
    let right = (a.x + a.width).min(b.x + b.width);
    (right - left).max(0.0)
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
    fn merges_vertically_stacked_single_characters_both_directions() {
        // A horizontal label rotated 90°: one character per line, stacked down
        // a column. Reassemble it both top-to-bottom and bottom-to-top, since
        // the rotation direction (and so the reading order) is unknown.
        let page = PageOcr {
            width: 200,
            height: 400,
            lines: vec![
                char_line("犬", 10.0, 0.0),
                char_line("芝", 10.0, 40.0),
                char_line("工", 10.0, 80.0),
                char_line("業", 10.0, 120.0),
            ],
        };

        let merged = merge_row_fragments(&page);

        let texts: Vec<String> = merged
            .lines
            .iter()
            .map(|line| line.text.replace([' ', '　'], ""))
            .collect();
        assert!(texts.contains(&"犬芝工業".to_string()), "{texts:?}");
        assert!(texts.contains(&"業工芝犬".to_string()), "{texts:?}");
    }

    #[test]
    fn keeps_a_grid_of_single_characters_separate() {
        // A table column of "+28" cells: single characters aligned in both a
        // row and a column form a grid, not one word. They must stay apart so
        // "+28+28…" is never fabricated into a phone number.
        let mut lines = Vec::new();
        for row in 0..4 {
            let y = row as f32 * 40.0;
            for (col, ch) in ["+", "2", "8"].iter().enumerate() {
                lines.push(char_line(ch, col as f32 * 25.0, y));
            }
        }
        let page = PageOcr {
            width: 200,
            height: 200,
            lines,
        };

        let merged = merge_row_fragments(&page);

        assert_eq!(merged.lines.len(), 12);
    }

    #[test]
    fn keeps_adjacent_multi_character_cells_separate() {
        // Two table cells on the same row, close together (separated only by a
        // ruling line): multi-character text must never merge into one word.
        let page = PageOcr {
            width: 400,
            height: 100,
            lines: vec![
                OcrLine {
                    text: "数量".to_string(),
                    words: vec![Span {
                        text: "数量".to_string(),
                        rect: Rect { x: 0.0, y: 10.0, width: 40.0, height: 20.0 },
                    }],
                },
                OcrLine {
                    text: "単価".to_string(),
                    words: vec![Span {
                        text: "単価".to_string(),
                        rect: Rect { x: 55.0, y: 10.0, width: 40.0, height: 20.0 },
                    }],
                },
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
