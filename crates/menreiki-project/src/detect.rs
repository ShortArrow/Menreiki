use std::fs;
use std::path::Path;

use menreiki_core::{Finding, PageOcr};
use menreiki_detect::RegexRule;

use crate::layout::{page_findings_path, page_ocr_path, FINDINGS_DIR};

#[derive(Debug, thiserror::Error)]
pub enum DetectPagesError {
    #[error("OCR result could not be read: {0}")]
    Read(std::io::Error),
    #[error("OCR result is not valid: {0}")]
    Parse(#[from] serde_json::Error),
    #[error("findings could not be written: {0}")]
    Write(std::io::Error),
}

/// Applies detection rules to every stored OCR result, writing one findings
/// JSON per page under `findings/`. Returns the number of pages processed.
pub fn detect_pages(project_dir: &Path, rules: &[RegexRule]) -> Result<u16, DetectPagesError> {
    fs::create_dir_all(project_dir.join(FINDINGS_DIR)).map_err(DetectPagesError::Write)?;

    let mut page_index: u16 = 0;
    while page_ocr_path(project_dir, page_index).exists() {
        let text = fs::read_to_string(page_ocr_path(project_dir, page_index))
            .map_err(DetectPagesError::Read)?;
        let ocr: PageOcr = serde_json::from_str(&text)?;
        let findings = menreiki_detect::detect_page(&ocr, rules);
        let json =
            serde_json::to_string_pretty(&findings).expect("findings are always serializable");
        fs::write(page_findings_path(project_dir, page_index), json)
            .map_err(DetectPagesError::Write)?;
        page_index += 1;
    }
    Ok(page_index)
}

/// Findings of one page, keyed by 0-based page index.
#[derive(Debug, Clone, PartialEq)]
pub struct PageFindings {
    pub page_index: u16,
    pub findings: Vec<Finding>,
}

#[derive(Debug, thiserror::Error)]
pub enum LoadFindingsError {
    #[error("findings could not be read: {0}")]
    Read(std::io::Error),
    #[error("findings are not valid: {0}")]
    Parse(#[from] serde_json::Error),
}

/// Reads back every per-page findings file written by [`detect_pages`].
pub fn load_findings(project_dir: &Path) -> Result<Vec<PageFindings>, LoadFindingsError> {
    let mut pages = Vec::new();
    let mut page_index: u16 = 0;
    while page_findings_path(project_dir, page_index).exists() {
        let text = fs::read_to_string(page_findings_path(project_dir, page_index))
            .map_err(LoadFindingsError::Read)?;
        pages.push(PageFindings {
            page_index,
            findings: serde_json::from_str(&text)?,
        });
        page_index += 1;
    }
    Ok(pages)
}
