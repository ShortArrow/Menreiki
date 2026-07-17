use std::fs;
use std::path::Path;

use menreiki_core::PageOcr;
use menreiki_ocr::{OcrEngine, OcrError};

use crate::layout::{page_image_path, page_ocr_path, OCR_DIR};

#[derive(Debug, thiserror::Error)]
pub enum OcrPagesError {
    #[error("page image could not be read: {0}")]
    Read(std::io::Error),
    #[error(transparent)]
    Ocr(#[from] OcrError),
    #[error("OCR result could not be written: {0}")]
    Write(std::io::Error),
}

/// Runs OCR over every rendered page image, storing one JSON per page under
/// `ocr/`, and returns the number of pages processed. Pages are processed in
/// order and written as soon as they finish, so a partial run leaves valid
/// per-page results behind.
pub fn ocr_pages(project_dir: &Path, engine: &dyn OcrEngine) -> Result<u16, OcrPagesError> {
    fs::create_dir_all(project_dir.join(OCR_DIR)).map_err(OcrPagesError::Write)?;

    let mut page_index: u16 = 0;
    while page_image_path(project_dir, page_index).exists() {
        let png = fs::read(page_image_path(project_dir, page_index)).map_err(OcrPagesError::Read)?;
        let page_ocr = engine.recognize(&png)?;
        let json =
            serde_json::to_string_pretty(&page_ocr).expect("OCR result is always serializable");
        fs::write(page_ocr_path(project_dir, page_index), json).map_err(OcrPagesError::Write)?;
        page_index += 1;
    }
    Ok(page_index)
}

#[derive(Debug, thiserror::Error)]
pub enum LoadOcrError {
    #[error("OCR result could not be read: {0}")]
    Read(std::io::Error),
    #[error("OCR result is not valid: {0}")]
    Parse(#[from] serde_json::Error),
}

/// Reads back every per-page OCR result written by [`ocr_pages`].
pub fn load_ocr_pages(project_dir: &Path) -> Result<Vec<PageOcr>, LoadOcrError> {
    let mut pages = Vec::new();
    let mut page_index: u16 = 0;
    while page_ocr_path(project_dir, page_index).exists() {
        let text = fs::read_to_string(page_ocr_path(project_dir, page_index))
            .map_err(LoadOcrError::Read)?;
        pages.push(serde_json::from_str(&text)?);
        page_index += 1;
    }
    Ok(pages)
}
