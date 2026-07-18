use crate::raster::{DocumentRasterizer, PageImage, RasterError};

/// Treats a single PNG or JPEG image as a one-page document, so scanned
/// pages and screenshots go through the same workflow as PDFs.
///
/// PNG input is passed through byte-for-byte (no recompression); other
/// formats are re-encoded to PNG. `dpi` is ignored — an image has no
/// physical page size, its pixels are used as-is.
pub struct ImageRasterizer;

impl DocumentRasterizer for ImageRasterizer {
    fn page_count(&self, document: &[u8]) -> Result<u16, RasterError> {
        image::guess_format(document)
            .map(|_| 1)
            .map_err(|error| RasterError::UnsupportedDocument(error.to_string()))
    }

    fn rasterize_page(
        &self,
        document: &[u8],
        page_index: u16,
        _dpi: u32,
    ) -> Result<PageImage, RasterError> {
        if page_index != 0 {
            return Err(RasterError::Page(
                page_index,
                "an image is a single-page document".to_string(),
            ));
        }
        let format = image::guess_format(document)
            .map_err(|error| RasterError::UnsupportedDocument(error.to_string()))?;
        let decoded = image::load_from_memory_with_format(document, format)
            .map_err(|error| RasterError::UnsupportedDocument(error.to_string()))?;
        let width = decoded.width();
        let height = decoded.height();

        let png = if format == image::ImageFormat::Png {
            document.to_vec()
        } else {
            let mut encoded = Vec::new();
            decoded
                .into_rgba8()
                .write_to(
                    &mut std::io::Cursor::new(&mut encoded),
                    image::ImageFormat::Png,
                )
                .map_err(|error| RasterError::Page(0, error.to_string()))?;
            encoded
        };
        Ok(PageImage { width, height, png })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};
    use std::io::Cursor;

    fn sample(format: image::ImageFormat) -> Vec<u8> {
        let image = RgbaImage::from_pixel(20, 10, Rgba([0, 128, 255, 255]));
        let mut bytes = Vec::new();
        let dynamic = image::DynamicImage::ImageRgba8(image);
        let dynamic = if format == image::ImageFormat::Jpeg {
            image::DynamicImage::ImageRgb8(dynamic.into_rgb8())
        } else {
            dynamic
        };
        dynamic
            .write_to(&mut Cursor::new(&mut bytes), format)
            .unwrap();
        bytes
    }

    #[test]
    fn a_png_is_one_page_passed_through_unchanged() {
        let png = sample(image::ImageFormat::Png);

        assert_eq!(ImageRasterizer.page_count(&png).unwrap(), 1);
        let page = ImageRasterizer.rasterize_page(&png, 0, 300).unwrap();
        assert_eq!(page.png, png);
        assert_eq!((page.width, page.height), (20, 10));
    }

    #[test]
    fn a_jpeg_is_reencoded_to_png() {
        let jpeg = sample(image::ImageFormat::Jpeg);

        let page = ImageRasterizer.rasterize_page(&jpeg, 0, 300).unwrap();

        assert_eq!(&page.png[..8], b"\x89PNG\r\n\x1a\n");
        assert_eq!((page.width, page.height), (20, 10));
    }

    #[test]
    fn only_page_zero_exists() {
        let png = sample(image::ImageFormat::Png);

        assert!(ImageRasterizer.rasterize_page(&png, 1, 300).is_err());
    }

    #[test]
    fn non_image_bytes_are_rejected() {
        assert!(ImageRasterizer.page_count(b"%PDF-1.7 not an image").is_err());
    }
}
