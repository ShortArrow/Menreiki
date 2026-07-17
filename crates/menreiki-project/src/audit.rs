use std::fs;
use std::path::Path;

use menreiki_audit::{audit_pages, AuditReport};
use menreiki_ocr::{OcrEngine, OcrError};
use menreiki_policy::{Action, Policy};

use crate::detect::{load_findings, LoadFindingsError, PageFindings};
use crate::layout::{audit_report_path, page_render_path, AUDIT_DIR};

#[derive(Debug, thiserror::Error)]
pub enum AuditOutputError {
    #[error("no deny terms; provide a policy or a word list")]
    NoTerms,
    #[error("no transformed pages found; run apply first")]
    NoRenders,
    #[error("transformed page could not be read: {0}")]
    Read(std::io::Error),
    #[error(transparent)]
    Ocr(#[from] OcrError),
    #[error(transparent)]
    Findings(#[from] LoadFindingsError),
    #[error("audit report could not be written: {0}")]
    Write(std::io::Error),
}

/// Re-runs OCR over the transformed pages and checks that no deny term is
/// still readable. Deny terms come from `extra_terms` plus, when a policy is
/// given, every text the policy transforms (its `text` rules verbatim, and
/// the recorded finding texts of its category rules). Writes
/// `audit/report.json` and returns the report.
pub fn audit_output(
    project_dir: &Path,
    policy: Option<&Policy>,
    extra_terms: &[String],
    engine: &dyn OcrEngine,
) -> Result<AuditReport, AuditOutputError> {
    let mut terms: Vec<String> = extra_terms
        .iter()
        .filter(|term| !term.trim().is_empty())
        .cloned()
        .collect();
    if let Some(policy) = policy {
        terms.extend(deny_terms_from_policy(policy, &load_findings(project_dir)?));
    }
    terms.sort();
    terms.dedup();
    if terms.is_empty() {
        return Err(AuditOutputError::NoTerms);
    }

    let mut pages = Vec::new();
    let mut page_index: u16 = 0;
    while page_render_path(project_dir, page_index).exists() {
        let png = fs::read(page_render_path(project_dir, page_index))
            .map_err(AuditOutputError::Read)?;
        pages.push(engine.recognize(&png)?);
        page_index += 1;
    }
    if pages.is_empty() {
        return Err(AuditOutputError::NoRenders);
    }

    let report = audit_pages(&pages, &terms);
    fs::create_dir_all(project_dir.join(AUDIT_DIR)).map_err(AuditOutputError::Write)?;
    let json = serde_json::to_string_pretty(&report).expect("report is always serializable");
    fs::write(audit_report_path(project_dir), json).map_err(AuditOutputError::Write)?;
    Ok(report)
}

fn deny_terms_from_policy(policy: &Policy, findings: &[PageFindings]) -> Vec<String> {
    let mut terms = Vec::new();
    for rule in &policy.rules {
        if matches!(rule.action, Action::Keep) {
            continue;
        }
        if let Some(text) = &rule.r#match.text {
            terms.push(text.clone());
        }
        if let Some(category) = &rule.r#match.category {
            for page in findings {
                for finding in &page.findings {
                    if &finding.category == category {
                        terms.push(finding.text.clone());
                    }
                }
            }
        }
    }
    terms
}
