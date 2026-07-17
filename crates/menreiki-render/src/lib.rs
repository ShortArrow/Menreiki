//! Rasterization port.
//!
//! Menreiki never edits a source document in place; every workflow stage
//! works on page images rendered from it. This crate defines the interface
//! a rendering backend (pdfium, or a future alternative) must implement.
//! Backends live under `adapters/`.

mod raster;

pub use raster::{DocumentRasterizer, PageImage, PageSink, RasterError};
