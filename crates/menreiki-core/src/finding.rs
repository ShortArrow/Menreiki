use serde::{Deserialize, Serialize};

use crate::geometry::Rect;

/// A candidate piece of identifying information detected on a page,
/// awaiting a human decision (keep, remove, mask, pseudonymize, generalize).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Finding {
    /// Information category, e.g. "email", "phone", "organization".
    pub category: String,
    /// The detected text as recognized on the page.
    pub text: String,
    /// Where the text sits, in page-image pixel coordinates.
    pub rect: Rect,
    /// Which detector produced this candidate, e.g. "regex", "dictionary",
    /// "layout", "llm".
    pub detector: String,
    /// The detector's explanation of why this is a candidate — advisory
    /// context for the reviewer, never a verdict.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Whether the detector saw this text but could not place it on the page
    /// (a VLM candidate OCR never read). Its `rect` is then the whole page, a
    /// placeholder no policy edits — a decision on it alone changes nothing
    /// until the reviewer boxes the occurrence. Omitted from JSON when false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub unlocated: bool,
}
