use std::path::{Path, PathBuf};

pub const MANIFEST_FILE_NAME: &str = "project.json";
pub const SOURCE_DIR: &str = "source";
pub const PAGES_DIR: &str = "pages";
pub const OCR_DIR: &str = "ocr";

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

fn page_file_name(page_index: u16, extension: &str) -> String {
    format!("page-{:03}.{extension}", u32::from(page_index) + 1)
}
