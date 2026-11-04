//! Errors returned to the frontend with a stable code.
//!
//! The frontend maps `code` to an i18n key (ADR-018), so the message the
//! user reads is in the UI language and says what to do next. `detail` is
//! the backend's own (English, developer-facing) message: it is shown as is
//! only when `code` is `None`, or as a supplement for codes that allow it.

use menreiki_inference::InferenceError;
use menreiki_project::{AuditOutputError, LlmDetectError};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct UiError {
    pub code: Option<&'static str>,
    pub detail: String,
}

impl UiError {
    pub fn audit(error: &AuditOutputError) -> Self {
        Self {
            code: audit_error_code(error),
            detail: error.to_string(),
        }
    }

    pub fn inference(error: &InferenceError) -> Self {
        Self {
            code: inference_error_code(error),
            detail: error.to_string(),
        }
    }

    pub fn llm_detect(error: &LlmDetectError) -> Self {
        Self {
            code: llm_detect_error_code(error),
            detail: error.to_string(),
        }
    }
}

impl From<String> for UiError {
    fn from(detail: String) -> Self {
        Self { code: None, detail }
    }
}

pub fn audit_error_code(error: &AuditOutputError) -> Option<&'static str> {
    match error {
        // The GUI checks for text rules before auditing, so these only reach
        // it from a policy it did not build; both mean "nothing to re-read".
        AuditOutputError::NoTerms | AuditOutputError::NoTextTerms(_) => Some("audit.noTerms"),
        _ => None,
    }
}

pub fn inference_error_code(error: &InferenceError) -> Option<&'static str> {
    match error {
        InferenceError::ModelMissing => Some("inference.modelMissing"),
        InferenceError::InvalidUrl(_) => Some("inference.invalidUrl"),
        InferenceError::NotLocal(_) => Some("inference.notLocal"),
        InferenceError::Request(_) => Some("inference.request"),
        InferenceError::Response(_) => None,
    }
}

pub fn llm_detect_error_code(error: &LlmDetectError) -> Option<&'static str> {
    match error {
        LlmDetectError::Inference(error) => inference_error_code(error),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audit_codes() {
        assert_eq!(
            audit_error_code(&AuditOutputError::NoTerms),
            Some("audit.noTerms")
        );
        assert_eq!(
            audit_error_code(&AuditOutputError::NoTextTerms(2)),
            Some("audit.noTerms")
        );
        assert_eq!(audit_error_code(&AuditOutputError::NoRenders), None);
    }

    #[test]
    fn inference_codes() {
        assert_eq!(
            inference_error_code(&InferenceError::ModelMissing),
            Some("inference.modelMissing")
        );
        assert_eq!(
            inference_error_code(&InferenceError::InvalidUrl("x".into())),
            Some("inference.invalidUrl")
        );
        assert_eq!(
            inference_error_code(&InferenceError::NotLocal("http://example.com".into())),
            Some("inference.notLocal")
        );
        assert_eq!(
            inference_error_code(&InferenceError::Request("refused".into())),
            Some("inference.request")
        );
        assert_eq!(
            inference_error_code(&InferenceError::Response("bad".into())),
            None
        );
    }

    #[test]
    fn llm_detect_codes_delegate_only_for_inference() {
        assert_eq!(
            llm_detect_error_code(&LlmDetectError::Inference(InferenceError::Request(
                "refused".into()
            ))),
            Some("inference.request")
        );
        assert_eq!(llm_detect_error_code(&LlmDetectError::Cancelled), None);
    }

    #[test]
    fn serializes_as_code_and_detail() {
        let json = serde_json::to_value(UiError::audit(&AuditOutputError::NoTerms)).unwrap();
        assert_eq!(json["code"], "audit.noTerms");
        assert!(json["detail"].is_string());
        let json = serde_json::to_value(UiError::from("boom".to_string())).unwrap();
        assert!(json["code"].is_null());
        assert_eq!(json["detail"], "boom");
    }
}
