use std::fs;
use std::path::Path;

use menreiki_core::Rect;
use serde::{Deserialize, Serialize};

use crate::layout::{decisions_path, DECISIONS_DIR};

/// The reviewer's work in progress: what to do with each finding, which
/// searched texts to transform, and which regions to blank. Persisted so
/// closing the app (or re-running analysis) never loses decisions.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ReviewDecisions {
    #[serde(default)]
    pub findings: Vec<FindingDecision>,
    #[serde(default)]
    pub texts: Vec<TextDecision>,
    #[serde(default)]
    pub regions: Vec<RegionDecision>,
}

/// Decision on a detected finding, identified by category and text so it
/// survives re-analysis (rects and page indexes may shift).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FindingDecision {
    pub category: String,
    pub text: String,
    /// "keep", "erase", "mask", or "replace".
    pub action: String,
    #[serde(default)]
    pub value: String,
}

/// Document-wide decision on a user-searched text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TextDecision {
    pub text: String,
    /// "erase", "mask", or "replace".
    pub action: String,
    #[serde(default)]
    pub value: String,
}

/// A rectangle to blank, on one page or on all of them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RegionDecision {
    pub rect: Rect,
    /// "erase" or "mask".
    pub action: String,
    /// 0-based page the rule is limited to; `None` applies to all pages.
    #[serde(default)]
    pub page: Option<u16>,
    /// 0-based page the rectangle was drawn on, for thumbnails.
    #[serde(default)]
    pub drawn_on: u16,
}

#[derive(Debug, thiserror::Error)]
pub enum DecisionsError {
    #[error("decisions could not be read: {0}")]
    Read(std::io::Error),
    #[error("decisions are not valid: {0}")]
    Parse(#[from] serde_json::Error),
    #[error("decisions could not be written: {0}")]
    Write(std::io::Error),
}

/// Reads the persisted review decisions; a project without any has the
/// empty default.
pub fn load_decisions(project_dir: &Path) -> Result<ReviewDecisions, DecisionsError> {
    let path = decisions_path(project_dir);
    if !path.exists() {
        return Ok(ReviewDecisions::default());
    }
    let text = fs::read_to_string(path).map_err(DecisionsError::Read)?;
    Ok(serde_json::from_str(&text)?)
}

pub fn save_decisions(
    project_dir: &Path,
    decisions: &ReviewDecisions,
) -> Result<(), DecisionsError> {
    fs::create_dir_all(project_dir.join(DECISIONS_DIR)).map_err(DecisionsError::Write)?;
    let text =
        serde_json::to_string_pretty(decisions).expect("decisions are always serializable");
    fs::write(decisions_path(project_dir), text).map_err(DecisionsError::Write)
}
