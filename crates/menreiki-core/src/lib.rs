//! Menreiki domain core.
//!
//! Holds the document-model value objects shared by every workflow stage
//! (import, detection, review, rendering, audit). No I/O lives here.

mod edit;
mod finding;
mod geometry;
mod ocr;
mod source;

pub use edit::{EditStyle, PageEdit};
pub use finding::Finding;
pub use geometry::Rect;
pub use ocr::{compose_line_text, OcrLine, PageOcr, Span};
pub use source::SourceDocument;
