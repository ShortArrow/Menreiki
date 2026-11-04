use std::fs;
use std::path::Path;

use menreiki_core::{Finding, Rect};

use crate::layout::page_findings_path;

/// Note attached to reviewer-asserted candidates.
const MANUAL_NOTE: &str = "手動指定（ここを検出）";

#[derive(Debug, thiserror::Error)]
pub enum ManualFindingError {
    #[error("findings could not be read: {0}")]
    Read(std::io::Error),
    #[error("findings are not valid: {0}")]
    Parse(#[from] serde_json::Error),
    #[error("findings could not be written: {0}")]
    Write(std::io::Error),
}

/// Adds a reviewer-asserted candidate ("Detect here") at the exact box they
/// drew. The coordinates are ground truth, so the finding is pinned there even
/// when page OCR misread the text and a literal search would miss it.
///
/// A box is only a duplicate when category, text, and rect all match: a
/// second occurrence of a known text on the same page, or a box drawn to
/// locate a whole-page (location-unknown) candidate, is a new position the
/// policy must edit and is therefore stored.
pub fn add_manual_finding(
    project_dir: &Path,
    page: u16,
    rect: Rect,
    category: &str,
    text: &str,
) -> Result<(), ManualFindingError> {
    let path = page_findings_path(project_dir, page);
    let mut findings: Vec<Finding> = if path.exists() {
        serde_json::from_str(&fs::read_to_string(&path).map_err(ManualFindingError::Read)?)?
    } else {
        Vec::new()
    };
    let duplicate = findings
        .iter()
        .any(|known| known.category == category && known.text == text && known.rect == rect);
    if duplicate {
        return Ok(());
    }
    findings.push(Finding {
        category: category.to_string(),
        text: text.to_string(),
        rect,
        detector: "manual".to_string(),
        note: Some(MANUAL_NOTE.to_string()),
        unlocated: false,
    });
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(ManualFindingError::Write)?;
    }
    let json = serde_json::to_string_pretty(&findings).expect("findings are always serializable");
    fs::write(&path, json).map_err(ManualFindingError::Write)
}
