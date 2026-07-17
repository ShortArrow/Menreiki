//! pdfium-backed implementation of the Menreiki rasterization port.
//!
//! Binds at runtime to the pdfium dynamic library (installed by
//! `scripts/fetch-pdfium.ps1`), renders each page to a bitmap, and streams
//! PNG-encoded pages to the caller's sink.

use std::io::Cursor;
use std::path::Path;

use menreiki_render::{DocumentRasterizer, PageImage, PageSink, RasterError};
use pdfium_render::prelude::*;

pub struct PdfiumRasterizer {
    pdfium: Pdfium,
}

#[derive(Debug, thiserror::Error)]
#[error("pdfium library could not be loaded: {0}")]
pub struct BindError(String);

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

    fn rasterize(
        &self,
        document: &[u8],
        dpi: u32,
        sink: &mut PageSink<'_>,
    ) -> Result<u16, RasterError> {
        let document = self
            .pdfium
            .load_pdf_from_byte_slice(document, None)
            .map_err(|error| RasterError::UnsupportedDocument(error.to_string()))?;
        let config = PdfRenderConfig::new().scale_page_by_factor(dpi as f32 / 72.0);
        let page_count = document.pages().len();
        for (index, page) in document.pages().iter().enumerate() {
            let index = index as u16;
            let image = render_page_to_png(&page, &config)
                .map_err(|reason| RasterError::Page(index, reason))?;
            sink(index, image)?;
        }
        Ok(page_count)
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
