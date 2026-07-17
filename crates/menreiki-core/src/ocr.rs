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
/// `text` is the engine's own line rendering, which applies
/// language-appropriate word spacing (Japanese lines are not
/// space-joined), so it must be stored rather than rebuilt from `words`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OcrLine {
    pub text: String,
    pub words: Vec<Span>,
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
}
