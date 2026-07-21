use std::fs;
use std::path::Path;

use menreiki_render::{DocumentRasterizer, RasterError};

use crate::layout::{page_image_path, PAGES_DIR, SOURCE_DIR};
use crate::manifest::{load_manifest, LoadError};

#[derive(Debug, thiserror::Error)]
pub enum AnalyzeError {
    #[error(transparent)]
    Manifest(#[from] LoadError),
    #[error("source document could not be read: {0}")]
    Source(std::io::Error),
    #[error("page image could not be written: {0}")]
    Pages(std::io::Error),
    #[error(transparent)]
    Raster(#[from] RasterError),
    #[error("analysis was cancelled")]
    Cancelled,
}

/// Renders every page of the project's source document into `pages/` and
/// returns the page count.
///
/// With `resume`, pages whose image already exists are skipped, so an
/// interrupted run continues where it stopped. `pages`, when `Some`,
/// re-renders only those 0-based pages (forced, ignoring `resume`) and leaves
/// the rest untouched — the mechanism behind re-analyzing a single page.
/// `on_page` receives each finished 0-based page index with the total page
/// count; returning `false` stops before the next page with
/// [`AnalyzeError::Cancelled`], leaving all finished pages valid.
pub fn analyze(
    project_dir: &Path,
    rasterizer: &dyn DocumentRasterizer,
    dpi: u32,
    resume: bool,
    pages: Option<&[u16]>,
    on_page: &mut dyn FnMut(u16, u16) -> bool,
) -> Result<u16, AnalyzeError> {
    let manifest = load_manifest(project_dir)?;
    let source_path = project_dir
        .join(SOURCE_DIR)
        .join(manifest.source().file_name());
    let source = fs::read(source_path).map_err(AnalyzeError::Source)?;
    fs::create_dir_all(project_dir.join(PAGES_DIR)).map_err(AnalyzeError::Pages)?;

    let total = rasterizer.page_count(&source)?;
    for page_index in 0..total {
        if let Some(selected) = pages {
            if !selected.contains(&page_index) {
                continue;
            }
            let image = rasterizer.rasterize_page(&source, page_index, dpi)?;
            fs::write(page_image_path(project_dir, page_index), &image.png)
                .map_err(AnalyzeError::Pages)?;
        } else {
            let path = page_image_path(project_dir, page_index);
            if !(resume && path.exists()) {
                let image = rasterizer.rasterize_page(&source, page_index, dpi)?;
                fs::write(path, &image.png).map_err(AnalyzeError::Pages)?;
            }
        }
        if !on_page(page_index, total) {
            return Err(AnalyzeError::Cancelled);
        }
    }
    Ok(total)
}
