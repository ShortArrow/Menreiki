//! Menreiki project format.
//!
//! A project is an on-disk directory holding everything one de-identification
//! job produces: the source snapshot, page images, OCR output, findings,
//! decisions, and audit results. This crate owns reading and writing that
//! layout; domain types come from `menreiki-core`.

mod analyze;
mod apply;
mod audit;
mod detect;
mod export;
mod import;
mod layout;
mod manifest;
mod ocr;
mod search;

pub use analyze::{analyze, AnalyzeError};
pub use apply::{apply, ApplyError, ApplySummary};
pub use audit::{audit_output, AuditOutputError};
pub use detect::{detect_pages, load_findings, DetectPagesError, LoadFindingsError, PageFindings};
pub use export::{export_pdf, ExportError};
pub use import::{import, ImportError};
pub use layout::{
    audit_report_path, page_findings_path, page_image_path, page_ocr_path, page_render_path,
    plan_path, sanitized_pdf_path, AUDIT_DIR, DECISIONS_DIR, FINDINGS_DIR, MANIFEST_FILE_NAME,
    OCR_DIR, OUTPUT_DIR, PAGES_DIR, RENDERS_DIR, SOURCE_DIR,
};
pub use manifest::{load_manifest, LoadError, ProjectManifest, SCHEMA_VERSION};
pub use ocr::{load_ocr_pages, ocr_pages, LoadOcrError, OcrPagesError};
pub use search::search_text;
