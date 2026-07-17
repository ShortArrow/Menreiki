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
}
