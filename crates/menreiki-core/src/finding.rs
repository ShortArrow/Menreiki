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
    /// Which detector produced this candidate, e.g. "regex", "dictionary".
    pub detector: String,
}
