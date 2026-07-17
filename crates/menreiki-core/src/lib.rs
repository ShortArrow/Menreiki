//! Menreiki domain core.
//!
//! Holds the document-model value objects shared by every workflow stage
//! (import, detection, review, rendering, audit). No I/O lives here.

mod geometry;
mod ocr;
mod source;

pub use geometry::Rect;
pub use ocr::{OcrLine, PageOcr, Span};
pub use source::SourceDocument;
