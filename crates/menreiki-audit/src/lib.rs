//! Post-transformation inspection.
//!
//! Re-checks the OCR of transformed pages for terms that must no longer
//! appear. A Pass verdict means the configured checks found nothing — it is
//! a statement about the checks, never a guarantee of absolute safety.

use menreiki_core::{PageOcr, Rect};
use menreiki_detect::{detect_page, RegexRule};
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Verdict {
    Pass,
    Fail,
}

/// One forbidden term still readable on a transformed page.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Residual {
    /// 1-based page number, matching what the user sees.
    pub page: u32,
    /// The deny term that matched.
    pub term: String,
    /// The text as recognized on the page.
    pub text: String,
    pub rect: Rect,
}

#[derive(Debug, Serialize)]
pub struct AuditReport {
    pub verdict: Verdict,
    pub checked_terms: usize,
    pub page_count: usize,
    pub residuals: Vec<Residual>,
}

/// Searches every page's OCR for every deny term.
pub fn audit_pages(pages: &[PageOcr], deny_terms: &[String]) -> AuditReport {
    let mut residuals = Vec::new();
    for term in deny_terms {
        let rule = [RegexRule::literal("residual", term)];
        for (page_index, page) in pages.iter().enumerate() {
            for finding in detect_page(page, &rule) {
                residuals.push(Residual {
                    page: page_index as u32 + 1,
                    term: term.clone(),
                    text: finding.text,
                    rect: finding.rect,
                });
            }
        }
    }
    AuditReport {
        verdict: if residuals.is_empty() {
            Verdict::Pass
        } else {
            Verdict::Fail
        },
        checked_terms: deny_terms.len(),
        page_count: pages.len(),
        residuals,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use menreiki_core::{OcrLine, Span};

    fn page_with_line(text: &str) -> PageOcr {
        PageOcr {
            width: 1000,
            height: 1000,
            lines: vec![OcrLine {
                text: text.to_string(),
                words: vec![Span {
                    text: text.to_string(),
                    rect: Rect {
                        x: 10.0,
                        y: 10.0,
                        width: 100.0,
                        height: 20.0,
                    },
                }],
            }],
        }
    }

    #[test]
    fn residual_term_fails_the_audit_with_its_location() {
        let pages = vec![
            page_with_line("nothing here"),
            page_with_line("contact taro@example.com now"),
        ];
        let terms = vec!["taro@example.com".to_string()];

        let report = audit_pages(&pages, &terms);

        assert_eq!(report.verdict, Verdict::Fail);
        assert_eq!(report.residuals.len(), 1);
        assert_eq!(report.residuals[0].page, 2);
        assert_eq!(report.residuals[0].term, "taro@example.com");
    }

    #[test]
    fn clean_pages_pass() {
        let pages = vec![page_with_line("nothing sensitive")];
        let terms = vec!["株式会社アルファ".to_string()];

        let report = audit_pages(&pages, &terms);

        assert_eq!(report.verdict, Verdict::Pass);
        assert!(report.residuals.is_empty());
        assert_eq!(report.checked_terms, 1);
        assert_eq!(report.page_count, 1);
    }
}
