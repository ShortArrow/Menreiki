//! Windows.Media.Ocr-backed implementation of the Menreiki OCR port.
//!
//! Uses the OCR engine built into Windows, so recognition is fully offline
//! and needs no model download. The engine caps input images at
//! `MaxImageDimension` pixels; larger pages are downscaled before
//! recognition and the resulting coordinates are scaled back to the
//! original image, so callers always receive original-image coordinates.

use image::imageops::FilterType;
use menreiki_core::{OcrLine, PageOcr, Rect, Span};
use menreiki_ocr::{OcrEngine, OcrError};
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine as NativeOcrEngine;
use windows::Storage::Streams::DataWriter;

pub struct WindowsOcrEngine {
    engine: NativeOcrEngine,
}

impl WindowsOcrEngine {
    /// Creates an engine for the languages installed in the user's profile.
    pub fn from_user_profile_languages() -> Result<Self, OcrError> {
        let engine = NativeOcrEngine::TryCreateFromUserProfileLanguages()
            .map_err(|error| OcrError::EngineUnavailable(error.to_string()))?;
        Ok(Self { engine })
    }
}

impl OcrEngine for WindowsOcrEngine {
    fn recognize(&self, png: &[u8]) -> Result<PageOcr, OcrError> {
        let decoded = image::load_from_memory_with_format(png, image::ImageFormat::Png)
            .map_err(|error| OcrError::InvalidImage(error.to_string()))?
            .into_rgba8();
        let (width, height) = decoded.dimensions();

        let max_dimension = NativeOcrEngine::MaxImageDimension()
            .map_err(|error| OcrError::Recognition(error.to_string()))?;
        let scale = fit_scale(width, height, max_dimension);
        let ocr_input = if scale < 1.0 {
            image::imageops::resize(
                &decoded,
                (width as f32 * scale) as u32,
                (height as f32 * scale) as u32,
                FilterType::Triangle,
            )
        } else {
            decoded
        };

        let lines = self
            .recognize_bitmap(&ocr_input)
            .map_err(|error| OcrError::Recognition(error.to_string()))?;
        Ok(PageOcr {
            width,
            height,
            lines: rescale_lines(lines, 1.0 / scale),
        })
    }
}

impl WindowsOcrEngine {
    fn recognize_bitmap(&self, rgba: &image::RgbaImage) -> windows::core::Result<Vec<OcrLine>> {
        let bitmap = software_bitmap_from_rgba(rgba)?;
        let result = self.engine.RecognizeAsync(&bitmap)?.get()?;

        let mut lines = Vec::new();
        for line in result.Lines()? {
            let mut words = Vec::new();
            for word in line.Words()? {
                let rect = word.BoundingRect()?;
                words.push(Span {
                    text: word.Text()?.to_string(),
                    rect: Rect {
                        x: rect.X,
                        y: rect.Y,
                        width: rect.Width,
                        height: rect.Height,
                    },
                });
            }
            lines.push(OcrLine {
                text: line.Text()?.to_string(),
                words,
            });
        }
        Ok(lines)
    }
}

fn software_bitmap_from_rgba(rgba: &image::RgbaImage) -> windows::core::Result<SoftwareBitmap> {
    let (width, height) = rgba.dimensions();
    let mut bgra = rgba.as_raw().clone();
    for pixel in bgra.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }

    let writer = DataWriter::new()?;
    writer.WriteBytes(&bgra)?;
    let buffer = writer.DetachBuffer()?;
    SoftwareBitmap::CreateCopyFromBuffer(
        &buffer,
        BitmapPixelFormat::Bgra8,
        width as i32,
        height as i32,
    )
}

/// Uniform factor that fits an image inside `max_dimension`, capped at 1.0
/// so images are never upscaled.
fn fit_scale(width: u32, height: u32, max_dimension: u32) -> f32 {
    let largest = width.max(height) as f32;
    (max_dimension as f32 / largest).min(1.0)
}

fn rescale_lines(lines: Vec<OcrLine>, factor: f32) -> Vec<OcrLine> {
    if factor == 1.0 {
        return lines;
    }
    lines
        .into_iter()
        .map(|line| OcrLine {
            text: line.text,
            words: line
                .words
                .into_iter()
                .map(|word| Span {
                    text: word.text,
                    rect: Rect {
                        x: word.rect.x * factor,
                        y: word.rect.y * factor,
                        width: word.rect.width * factor,
                        height: word.rect.height * factor,
                    },
                })
                .collect(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::fit_scale;

    #[test]
    fn keeps_small_images_unscaled() {
        assert_eq!(fit_scale(400, 120, 2600), 1.0);
    }

    #[test]
    fn shrinks_oversized_images_to_the_cap() {
        let scale = fit_scale(2550, 3300, 2600);

        assert!((3300.0 * scale).round() <= 2600.0);
        assert!(scale > 0.7);
    }
}
