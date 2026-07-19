//! pdfium-backed implementation of the Menreiki rasterization port.
//!
//! Binds at runtime to the pdfium dynamic library (installed by
//! `scripts/fetch-pdfium.ps1`), renders each page to a bitmap, and streams
//! PNG-encoded pages to the caller's sink.

use std::io::Cursor;
use std::path::{Path, PathBuf};

use menreiki_render::{DocumentRasterizer, PageImage, RasterError};
use pdfium_render::prelude::*;
use sha2::{Digest, Sha256};

pub struct PdfiumRasterizer {
    pdfium: Pdfium,
}

#[derive(Debug, thiserror::Error)]
#[error("pdfium library could not be loaded: {0}")]
pub struct BindError(String);

/// Finds the pdfium dynamic library, in order: the `MENREIKI_PDFIUM_PATH`
/// override, the executable's directory, a `vendor/pdfium` in any ancestor
/// of the working directory (the development layout), and finally the
/// `embedded` copy extracted under `%LOCALAPPDATA%\Menreiki\pdfium` — the
/// path that makes a single-file distribution work without an installer.
pub fn library_dir(embedded: Option<&[u8]>) -> Result<PathBuf, BindError> {
    if let Some(dir) = std::env::var_os("MENREIKI_PDFIUM_PATH") {
        return Ok(PathBuf::from(dir));
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.to_path_buf());
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        for ancestor in cwd.ancestors() {
            candidates.push(ancestor.join("vendor").join("pdfium"));
        }
    }
    if let Some(found) = candidates
        .into_iter()
        .find(|dir| dir.join("pdfium.dll").exists())
    {
        return Ok(found);
    }

    let embedded = embedded.ok_or_else(|| {
        BindError(
            "pdfium.dll not found; run scripts/fetch-pdfium.ps1 or set MENREIKI_PDFIUM_PATH"
                .to_string(),
        )
    })?;
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| BindError("LOCALAPPDATA is not set".to_string()))?
        .join("Menreiki")
        .join("pdfium");
    install_embedded(embedded, &base).map_err(|error| BindError(error.to_string()))
}

/// Extracts the embedded library into a content-addressed directory under
/// `base` (reused when already present) and returns that directory. The
/// content hash in the path means an updated binary never collides with a
/// previous version's extraction.
pub fn install_embedded(embedded: &[u8], base: &Path) -> std::io::Result<PathBuf> {
    let digest = Sha256::digest(embedded);
    let tag: String = digest.iter().take(8).map(|byte| format!("{byte:02x}")).collect();
    let dir = base.join(tag);
    let target = dir.join("pdfium.dll");
    if !target.exists() {
        std::fs::create_dir_all(&dir)?;
        let staging = dir.join("pdfium.dll.partial");
        std::fs::write(&staging, embedded)?;
        std::fs::rename(&staging, &target)?;
    }
    Ok(dir)
}

impl PdfiumRasterizer {
    /// Binds to the pdfium dynamic library inside `library_dir`.
    pub fn new(library_dir: &Path) -> Result<Self, BindError> {
        let library = Pdfium::pdfium_platform_library_name_at_path(&library_dir);
        let bindings =
            Pdfium::bind_to_library(library).map_err(|error| BindError(error.to_string()))?;
        Ok(Self {
            pdfium: Pdfium::new(bindings),
        })
    }
}

impl DocumentRasterizer for PdfiumRasterizer {
    fn page_count(&self, document: &[u8]) -> Result<u16, RasterError> {
        let document = self
            .pdfium
            .load_pdf_from_byte_slice(document, None)
            .map_err(|error| RasterError::UnsupportedDocument(error.to_string()))?;
        Ok(document.pages().len())
    }

    fn rasterize_page(
        &self,
        document: &[u8],
        page_index: u16,
        dpi: u32,
    ) -> Result<PageImage, RasterError> {
        let document = self
            .pdfium
            .load_pdf_from_byte_slice(document, None)
            .map_err(|error| RasterError::UnsupportedDocument(error.to_string()))?;
        let page = document
            .pages()
            .get(page_index)
            .map_err(|error| RasterError::Page(page_index, error.to_string()))?;
        let config = PdfRenderConfig::new().scale_page_by_factor(dpi as f32 / 72.0);
        render_page_to_png(&page, &config).map_err(|reason| RasterError::Page(page_index, reason))
    }
}

fn render_page_to_png(page: &PdfPage<'_>, config: &PdfRenderConfig) -> Result<PageImage, String> {
    let bitmap = page
        .render_with_config(config)
        .map_err(|error| error.to_string())?;
    let width = bitmap.width() as u32;
    let height = bitmap.height() as u32;
    let pixels = bitmap.as_rgba_bytes();
    let image = image::RgbaImage::from_raw(width, height, pixels)
        .ok_or_else(|| "bitmap dimensions do not match pixel buffer".to_string())?;
    let mut png = Vec::new();
    image::DynamicImage::ImageRgba8(image)
        .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    Ok(PageImage { width, height, png })
}
