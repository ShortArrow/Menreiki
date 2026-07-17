use std::fs;
use std::path::{Path, PathBuf};

use menreiki_render::{build_image_pdf, PdfBuildError};

use crate::layout::{page_image_path, page_render_path, sanitized_pdf_path, OUTPUT_DIR};

#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    #[error("no page images found; run analyze (and apply) first")]
    NoPages,
    #[error("page image could not be read: {0}")]
    Read(std::io::Error),
    #[error(transparent)]
    Build(#[from] PdfBuildError),
    #[error("output could not be written: {0}")]
    Write(std::io::Error),
}

/// Rebuilds a PDF from the project's page images and returns its path.
///
/// Transformed pages under `renders/` are used when present; otherwise the
/// untransformed `pages/` are exported. The PDF is built from pixels alone,
/// so nothing from the source document carries over.
pub fn export_pdf(project_dir: &Path, dpi: u32) -> Result<PathBuf, ExportError> {
    let use_renders = page_render_path(project_dir, 0).exists();
    let page_path = |index: u16| {
        if use_renders {
            page_render_path(project_dir, index)
        } else {
            page_image_path(project_dir, index)
        }
    };

    let mut pngs = Vec::new();
    let mut page_index: u16 = 0;
    while page_path(page_index).exists() {
        pngs.push(fs::read(page_path(page_index)).map_err(ExportError::Read)?);
        page_index += 1;
    }
    if pngs.is_empty() {
        return Err(ExportError::NoPages);
    }

    let pdf = build_image_pdf(&pngs, dpi)?;
    fs::create_dir_all(project_dir.join(OUTPUT_DIR)).map_err(ExportError::Write)?;
    let output = sanitized_pdf_path(project_dir);
    fs::write(&output, pdf).map_err(ExportError::Write)?;
    Ok(output)
}
