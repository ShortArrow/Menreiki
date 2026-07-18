//! Menreiki project format.
//!
//! A project is an on-disk directory holding everything one de-identification
//! job produces: the source snapshot, page images, OCR output, findings,
//! decisions, and audit results. This crate owns reading and writing that
//! layout; domain types come from `menreiki-core`.

mod analyze;
mod apply;
mod audit;
mod decisions;
mod detect;
mod dictionary;
mod entities;
mod export;
mod import;
mod layout;
mod maintenance;
mod manifest;
mod markdown;
mod ocr;
mod search;

pub use analyze::{analyze, AnalyzeError};
pub use apply::{apply, ApplyError, ApplySummary};
pub use audit::{audit_output, AuditOutputError};
pub use decisions::{
    load_decisions, save_decisions, DecisionsError, FindingDecision, RegionDecision,
    ReviewDecisions, TextDecision,
};
pub use detect::{detect_pages, load_findings, DetectPagesError, LoadFindingsError, PageFindings};
pub use dictionary::{
    add_dictionary_entry, dictionary_rules, load_dictionary, remove_dictionary_entry,
    DictionaryEntry, DictionaryError,
};
pub use entities::{load_entities, save_entities, EntitiesError};
pub use export::{export_pdf, ExportError};
pub use import::{import, ImportError};
pub use layout::{
    audit_report_path, decisions_path, dictionary_path, entities_path, page_findings_path,
    page_image_path,
    page_ocr_path, page_render_path, plan_path, sanitized_markdown_path, sanitized_pdf_path,
    AUDIT_DIR, DECISIONS_DIR, ENTITIES_DIR, FINDINGS_DIR, MANIFEST_FILE_NAME, OCR_DIR,
    OUTPUT_DIR, PAGES_DIR, RENDERS_DIR, RULES_DIR, SOURCE_DIR,
};
pub use maintenance::clear_analysis;
pub use manifest::{load_manifest, LoadError, ProjectManifest, SCHEMA_VERSION};
pub use markdown::{export_markdown, render_markdown, MarkdownError};
pub use ocr::{load_ocr_pages, ocr_pages, LoadOcrError, OcrPagesError};
pub use search::search_text;
