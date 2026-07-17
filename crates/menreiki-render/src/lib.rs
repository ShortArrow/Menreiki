//! Page-image rendering: the rasterization port and page-image editing.
//!
//! Menreiki never edits a source document in place; every workflow stage
//! works on page images rendered from it. This crate defines the interface
//! a rendering backend (pdfium, or a future alternative) must implement —
//! backends live under `adapters/` — and applies planned edits (erase,
//! mask, replacement text) to rendered pages.

mod edit;
mod raster;

pub use edit::{apply_edits, load_font, EditError};
pub use raster::{DocumentRasterizer, PageImage, PageSink, RasterError};

pub use ab_glyph::FontVec;
