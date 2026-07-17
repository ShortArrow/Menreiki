//! Menreiki project format.
//!
//! A project is an on-disk directory holding everything one de-identification
//! job produces: the source snapshot, page images, OCR output, findings,
//! decisions, and audit results. This crate owns reading and writing that
//! layout; domain types come from `menreiki-core`.

mod analyze;
mod import;
mod layout;
mod manifest;
mod ocr;

pub use analyze::{analyze, AnalyzeError};
pub use import::{import, ImportError};
pub use layout::{
    page_image_path, page_ocr_path, MANIFEST_FILE_NAME, OCR_DIR, PAGES_DIR, SOURCE_DIR,
};
pub use manifest::{load_manifest, LoadError, ProjectManifest, SCHEMA_VERSION};
pub use ocr::{ocr_pages, OcrPagesError};
