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
    #[error("pages directory could not be created: {0}")]
    Pages(std::io::Error),
    #[error(transparent)]
    Raster(#[from] RasterError),
}

/// Renders every page of the project's source document into `pages/` and
/// returns the page count. `on_page` receives each finished 0-based page
/// index together with the total page count, so callers can show
/// "page 3 of 12" progress from the first page on.
pub fn analyze(
    project_dir: &Path,
    rasterizer: &dyn DocumentRasterizer,
    dpi: u32,
    on_page: &mut dyn FnMut(u16, u16),
) -> Result<u16, AnalyzeError> {
    let manifest = load_manifest(project_dir)?;
    let source_path = project_dir
        .join(SOURCE_DIR)
        .join(manifest.source().file_name());
    let source = fs::read(source_path).map_err(AnalyzeError::Source)?;
    fs::create_dir_all(project_dir.join(PAGES_DIR)).map_err(AnalyzeError::Pages)?;

    let total = rasterizer.page_count(&source)?;
    let page_count = rasterizer.rasterize(&source, dpi, &mut |page_index, image| {
        fs::write(page_image_path(project_dir, page_index), &image.png)?;
        on_page(page_index, total);
        Ok(())
    })?;
    Ok(page_count)
}
