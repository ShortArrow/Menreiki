use std::path::Path;

use menreiki_lang_ja::literal_rule;

use crate::detect::PageFindings;
use crate::ocr::{load_ocr_pages, LoadOcrError};

/// Finds every occurrence of a user-supplied string across the document's
/// OCR results — the entry point for enumerating anonymization candidates
/// by name before deciding how to transform them.
pub fn search_text(project_dir: &Path, text: &str) -> Result<Vec<PageFindings>, LoadOcrError> {
    let rule = [literal_rule("search", text)];
    Ok(load_ocr_pages(project_dir)?
        .iter()
        .enumerate()
        .map(|(page_index, ocr)| PageFindings {
            page_index: page_index as u16,
            findings: menreiki_detect::detect_page(ocr, &rule),
        })
        .collect())
}
