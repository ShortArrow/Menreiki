use std::fs;
use std::path::Path;

use menreiki_core::Finding;
use menreiki_detect::RegexRule;

use crate::layout::{page_findings_path, FINDINGS_DIR};
use crate::ocr::{load_ocr_pages, LoadOcrError};

#[derive(Debug, thiserror::Error)]
pub enum DetectPagesError {
    #[error(transparent)]
    Load(#[from] LoadOcrError),
    #[error("findings could not be written: {0}")]
    Write(std::io::Error),
}

/// Applies detection rules to every stored OCR result, adds cross-page
/// repeated-layout candidates (headers, footers, page numbers), drops any
/// finding on the project's ignore list, and writes one findings JSON per
/// page under `findings/`. Returns the number of pages processed.
pub fn detect_pages(project_dir: &Path, rules: &[RegexRule]) -> Result<u16, DetectPagesError> {
    let ocr_pages = load_ocr_pages(project_dir)?;
    let repeated = menreiki_detect::detect_repeated_lines(&ocr_pages);
    let ignored = crate::load_project_settings(project_dir)
        .map(|settings| settings.ignored)
        .unwrap_or_default();
    fs::create_dir_all(project_dir.join(FINDINGS_DIR)).map_err(DetectPagesError::Write)?;

    for (page_index, ocr) in ocr_pages.iter().enumerate() {
        let mut findings = menreiki_detect::detect_page(ocr, rules);
        findings.extend(repeated[page_index].iter().cloned());
        findings.retain(|finding| {
            !ignored
                .iter()
                .any(|entry| entry.matches(&finding.text, &finding.category))
        });
        let json =
            serde_json::to_string_pretty(&findings).expect("findings are always serializable");
        fs::write(page_findings_path(project_dir, page_index as u16), json)
            .map_err(DetectPagesError::Write)?;
    }
    Ok(ocr_pages.len() as u16)
}

/// Findings of one page, keyed by 0-based page index.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
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
