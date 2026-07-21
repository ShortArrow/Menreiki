use serde::{Deserialize, Serialize};

use crate::geometry::Rect;

/// One planned change to a page image.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PageEdit {
    pub rect: Rect,
    pub style: EditStyle,
}

/// How a region is transformed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum EditStyle {
    /// Paint the region in the page background color, leaving no visible trace.
    Erase,
    /// Cover the region with a solid box that shows something was removed.
    Mask,
    /// Erase the region and draw replacement text in its place. `align`
    /// controls horizontal placement when the substitute is a different
    /// length than the original — the reviewer's choice per rule.
    ReplaceText {
        text: String,
        #[serde(default)]
        align: TextAlign,
    },
}

/// Horizontal placement of replacement text within its region.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TextAlign {
    Left,
    #[default]
    Center,
    Right,
}
