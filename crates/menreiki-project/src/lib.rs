//! Menreiki project format.
//!
//! A project is an on-disk directory holding everything one de-identification
//! job produces: the source snapshot, page images, OCR output, findings,
//! decisions, and audit results. This crate owns reading and writing that
//! layout; domain types come from `menreiki-core`.

mod analyze;
mod apply;
mod detect;
mod import;
mod layout;
mod manifest;
mod ocr;
mod search;

pub use analyze::{analyze, AnalyzeError};
pub use apply::{apply, ApplyError, ApplySummary};
pub use detect::{detect_pages, load_findings, DetectPagesError, LoadFindingsError, PageFindings};
pub use import::{import, ImportError};
pub use layout::{
    page_findings_path, page_image_path, page_ocr_path, page_render_path, plan_path,
    DECISIONS_DIR, FINDINGS_DIR, MANIFEST_FILE_NAME, OCR_DIR, PAGES_DIR, RENDERS_DIR, SOURCE_DIR,
};
pub use manifest::{load_manifest, LoadError, ProjectManifest, SCHEMA_VERSION};
pub use ocr::{load_ocr_pages, ocr_pages, LoadOcrError, OcrPagesError};
pub use search::search_text;
