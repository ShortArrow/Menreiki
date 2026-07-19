use std::fs;
use std::path::Path;

use menreiki_core::Finding;
use menreiki_detect::RegexRule;
use menreiki_inference::{CandidateDetector, InferenceError};

use crate::layout::{page_findings_path, FINDINGS_DIR};
use crate::ocr::{load_ocr_pages, LoadOcrError};

#[derive(Debug, thiserror::Error)]
pub enum LlmDetectError {
    #[error(transparent)]
    Load(#[from] LoadOcrError),
    #[error(transparent)]
    Inference(#[from] InferenceError),
    #[error("findings could not be read: {0}")]
    Read(std::io::Error),
    #[error("findings are not valid: {0}")]
    Parse(#[from] serde_json::Error),
    #[error("findings could not be written: {0}")]
    Write(std::io::Error),
    #[error("LLM detection was cancelled")]
    Cancelled,
}

/// Asks the local model for anonymization candidates on every page and
/// merges them into the stored findings as advisory `llm` entries.
///
/// Model answers are mapped back to page coordinates through the same
/// OCR-tolerant matching as search; a candidate the model rephrased (and
/// that therefore matches nothing on the page) is dropped rather than
/// shown without a location. Findings that already exist with the same
/// category and text are kept, not duplicated, so re-running is safe.
pub fn llm_detect_pages(
    project_dir: &Path,
    detector: &dyn CandidateDetector,
    on_page: &mut dyn FnMut(u16, u16) -> bool,
) -> Result<u16, LlmDetectError> {
    let ocr_pages = load_ocr_pages(project_dir)?;
    fs::create_dir_all(project_dir.join(FINDINGS_DIR)).map_err(LlmDetectError::Write)?;

    let total = ocr_pages.len() as u16;
    for (index, ocr) in ocr_pages.iter().enumerate() {
        let page_index = index as u16;
        let text = ocr.text();
        if !text.trim().is_empty() {
            let candidates = detector.detect(&text)?;
            let path = page_findings_path(project_dir, page_index);
            let mut findings: Vec<Finding> = if path.exists() {
                serde_json::from_str(&fs::read_to_string(&path).map_err(LlmDetectError::Read)?)?
            } else {
                Vec::new()
            };
            for candidate in candidates {
                let rule = [RegexRule::literal(&candidate.category, &candidate.text)];
                for hit in menreiki_detect::detect_page(ocr, &rule) {
                    let duplicate = findings
                        .iter()
                        .any(|known| known.category == hit.category && known.text == hit.text);
                    if duplicate {
                        continue;
                    }
                    findings.push(Finding {
                        detector: "llm".to_string(),
                        note: (!candidate.reason.trim().is_empty())
                            .then(|| candidate.reason.clone()),
                        ..hit
                    });
                }
            }
            let json = serde_json::to_string_pretty(&findings)
                .expect("findings are always serializable");
            fs::write(path, json).map_err(LlmDetectError::Write)?;
        }
        if !on_page(page_index, total) {
            return Err(LlmDetectError::Cancelled);
        }
    }
    Ok(total)
}
