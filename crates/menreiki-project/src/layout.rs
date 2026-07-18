use std::path::{Path, PathBuf};

pub const MANIFEST_FILE_NAME: &str = "project.json";
pub const SOURCE_DIR: &str = "source";
pub const PAGES_DIR: &str = "pages";
pub const OCR_DIR: &str = "ocr";
pub const FINDINGS_DIR: &str = "findings";
pub const DECISIONS_DIR: &str = "decisions";
pub const RENDERS_DIR: &str = "renders";
pub const OUTPUT_DIR: &str = "output";
pub const AUDIT_DIR: &str = "audit";
pub const RULES_DIR: &str = "rules";

/// Location of the rendered image for a 0-based page index: `pages/page-001.png`.
pub fn page_image_path(project_dir: &Path, page_index: u16) -> PathBuf {
    project_dir
        .join(PAGES_DIR)
        .join(page_file_name(page_index, "png"))
}

/// Location of the OCR result for a 0-based page index: `ocr/page-001.json`.
pub fn page_ocr_path(project_dir: &Path, page_index: u16) -> PathBuf {
    project_dir
        .join(OCR_DIR)
        .join(page_file_name(page_index, "json"))
}

/// Location of the findings for a 0-based page index: `findings/page-001.json`.
pub fn page_findings_path(project_dir: &Path, page_index: u16) -> PathBuf {
    project_dir
        .join(FINDINGS_DIR)
        .join(page_file_name(page_index, "json"))
}

/// Location of the transformed image for a 0-based page index:
/// `renders/page-001.png`.
pub fn page_render_path(project_dir: &Path, page_index: u16) -> PathBuf {
    project_dir
        .join(RENDERS_DIR)
        .join(page_file_name(page_index, "png"))
}

/// Location of the persisted edit plan: `decisions/plan.json`.
pub fn plan_path(project_dir: &Path) -> PathBuf {
    project_dir.join(DECISIONS_DIR).join("plan.json")
}

/// Location of the persisted review decisions: `decisions/decisions.json`.
pub fn decisions_path(project_dir: &Path) -> PathBuf {
    project_dir.join(DECISIONS_DIR).join("decisions.json")
}

/// Location of the reconstructed document: `output/sanitized.pdf`.
pub fn sanitized_pdf_path(project_dir: &Path) -> PathBuf {
    project_dir.join(OUTPUT_DIR).join("sanitized.pdf")
}

/// Location of the Markdown rendition: `output/sanitized.md`.
pub fn sanitized_markdown_path(project_dir: &Path) -> PathBuf {
    project_dir.join(OUTPUT_DIR).join("sanitized.md")
}

/// Location of the audit report: `audit/report.json`.
pub fn audit_report_path(project_dir: &Path) -> PathBuf {
    project_dir.join(AUDIT_DIR).join("report.json")
}

/// Location of the user dictionary: `rules/dictionary.json`.
pub fn dictionary_path(project_dir: &Path) -> PathBuf {
    project_dir.join(RULES_DIR).join("dictionary.json")
}

fn page_file_name(page_index: u16, extension: &str) -> String {
    format!("page-{:03}.{extension}", u32::from(page_index) + 1)
}
