//! OCR port.
//!
//! Defines the interface an OCR backend must implement. Backends live under
//! `adapters/` (Windows OCR first; Tesseract or ONNX models can follow
//! without touching the rest of the workflow).

use menreiki_core::PageOcr;

#[derive(Debug, thiserror::Error)]
pub enum OcrError {
    #[error("page image could not be decoded: {0}")]
    InvalidImage(String),
    #[error("OCR engine is unavailable: {0}")]
    EngineUnavailable(String),
    #[error("recognition failed: {0}")]
    Recognition(String),
}

/// Recognizes text in a PNG-encoded page image.
///
/// Results are reported in the coordinates of the supplied image, whatever
/// internal scaling the backend applies.
pub trait OcrEngine {
    fn recognize(&self, png: &[u8]) -> Result<PageOcr, OcrError>;
}
