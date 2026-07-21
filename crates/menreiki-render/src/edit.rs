use std::io::Cursor;
use std::path::Path;

use ab_glyph::{FontVec, PxScale};
use image::{Rgba, RgbaImage};
use imageproc::drawing::{draw_filled_rect_mut, draw_text_mut, text_size};
use imageproc::rect::Rect as PixelRect;
use menreiki_core::{EditStyle, PageEdit, Rect, TextAlign};

const PAPER_WHITE: Rgba<u8> = Rgba([255, 255, 255, 255]);
const MASK_BLACK: Rgba<u8> = Rgba([0, 0, 0, 255]);
const TEXT_BLACK: Rgba<u8> = Rgba([16, 16, 16, 255]);

#[derive(Debug, thiserror::Error)]
pub enum EditError {
    #[error("page image could not be decoded: {0}")]
    Decode(String),
    #[error("page image could not be encoded: {0}")]
    Encode(String),
    #[error("font could not be loaded: {0}")]
    Font(String),
    #[error("a replace-text edit requires a font")]
    FontRequired,
}

/// Loads a TrueType font (or the first face of a collection) for
/// replacement-text drawing.
pub fn load_font(path: &Path) -> Result<FontVec, EditError> {
    let bytes = std::fs::read(path).map_err(|error| EditError::Font(error.to_string()))?;
    FontVec::try_from_vec_and_index(bytes, 0).map_err(|error| EditError::Font(error.to_string()))
}

/// Applies planned edits to a PNG page image and returns the edited PNG.
///
/// Edits outside the image are clipped; `font` is only required when an
/// edit draws replacement text.
pub fn apply_edits(
    png: &[u8],
    edits: &[PageEdit],
    font: Option<&FontVec>,
) -> Result<Vec<u8>, EditError> {
    let mut image = image::load_from_memory_with_format(png, image::ImageFormat::Png)
        .map_err(|error| EditError::Decode(error.to_string()))?
        .into_rgba8();

    for edit in edits {
        let Some(area) = clip_to_image(&edit.rect, &image) else {
            continue;
        };
        match &edit.style {
            EditStyle::Erase => draw_filled_rect_mut(&mut image, area, PAPER_WHITE),
            EditStyle::Mask => draw_filled_rect_mut(&mut image, area, MASK_BLACK),
            EditStyle::ReplaceText { text, align } => {
                draw_filled_rect_mut(&mut image, area, PAPER_WHITE);
                let font = font.ok_or(EditError::FontRequired)?;
                draw_fitted_text(&mut image, area, text, font, *align);
            }
        }
    }

    let mut png_out = Vec::new();
    image::DynamicImage::ImageRgba8(image)
        .write_to(&mut Cursor::new(&mut png_out), image::ImageFormat::Png)
        .map_err(|error| EditError::Encode(error.to_string()))?;
    Ok(png_out)
}

fn clip_to_image(rect: &Rect, image: &RgbaImage) -> Option<PixelRect> {
    let left = rect.x.max(0.0).floor() as i32;
    let top = rect.y.max(0.0).floor() as i32;
    let right = ((rect.x + rect.width).ceil() as i32).min(image.width() as i32);
    let bottom = ((rect.y + rect.height).ceil() as i32).min(image.height() as i32);
    if right <= left || bottom <= top {
        return None;
    }
    Some(PixelRect::at(left, top).of_size((right - left) as u32, (bottom - top) as u32))
}

/// Draws `text` in `area`, aligned horizontally per `align` and shrunk as
/// needed (PRD's automatic shrink when a replacement does not fit its region).
/// Alignment lets the reviewer keep a shorter or longer substitute flush with
/// the original's left or right edge instead of always centered.
fn draw_fitted_text(
    image: &mut RgbaImage,
    area: PixelRect,
    text: &str,
    font: &FontVec,
    align: TextAlign,
) {
    let mut scale = PxScale::from(area.height() as f32 * 0.8);
    let (text_width, _) = text_size(scale, font, text);
    if text_width > 0 && text_width as f32 > area.width() as f32 {
        scale = PxScale::from(scale.y * area.width() as f32 / text_width as f32);
    }
    let (fitted_width, fitted_height) = text_size(scale, font, text);
    let slack = (area.width() as i32 - fitted_width as i32).max(0);
    let offset_x = match align {
        TextAlign::Left => 0,
        TextAlign::Center => slack / 2,
        TextAlign::Right => slack,
    };
    let x = area.left() + offset_x;
    let y = area.top() + ((area.height() as i32 - fitted_height as i32) / 2).max(0);
    draw_text_mut(image, TEXT_BLACK, x, y, scale, font, text);
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: Rgba<u8> = Rgba([200, 0, 0, 255]);

    fn red_png(width: u32, height: u32) -> Vec<u8> {
        let image = RgbaImage::from_pixel(width, height, RED);
        let mut png = Vec::new();
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        png
    }

    fn decode(png: &[u8]) -> RgbaImage {
        image::load_from_memory(png).unwrap().into_rgba8()
    }

    fn rect(x: f32, y: f32, width: f32, height: f32) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn erase_paints_the_region_white_and_leaves_the_rest() {
        let png = red_png(50, 50);
        let edits = [PageEdit {
            rect: rect(10.0, 10.0, 20.0, 20.0),
            style: EditStyle::Erase,
        }];

        let out = decode(&apply_edits(&png, &edits, None).unwrap());

        assert_eq!(*out.get_pixel(15, 15), PAPER_WHITE);
        assert_eq!(*out.get_pixel(5, 5), RED);
        assert_eq!(*out.get_pixel(35, 35), RED);
    }

    #[test]
    fn mask_paints_the_region_black() {
        let png = red_png(50, 50);
        let edits = [PageEdit {
            rect: rect(0.0, 0.0, 50.0, 10.0),
            style: EditStyle::Mask,
        }];

        let out = decode(&apply_edits(&png, &edits, None).unwrap());

        assert_eq!(*out.get_pixel(25, 5), MASK_BLACK);
        assert_eq!(*out.get_pixel(25, 20), RED);
    }

    #[test]
    fn edits_outside_the_image_are_clipped() {
        let png = red_png(50, 50);
        let edits = [PageEdit {
            rect: rect(40.0, 40.0, 100.0, 100.0),
            style: EditStyle::Erase,
        }];

        let out = decode(&apply_edits(&png, &edits, None).unwrap());

        assert_eq!(*out.get_pixel(45, 45), PAPER_WHITE);
        assert_eq!(*out.get_pixel(35, 35), RED);
    }

    #[test]
    fn replace_text_without_font_is_an_error() {
        let png = red_png(50, 50);
        let edits = [PageEdit {
            rect: rect(0.0, 0.0, 50.0, 20.0),
            style: EditStyle::ReplaceText {
                text: "X".to_string(),
                align: TextAlign::Center,
            },
        }];

        let result = apply_edits(&png, &edits, None);

        assert!(matches!(result, Err(EditError::FontRequired)));
    }

    #[test]
    fn replace_text_erases_then_draws_visible_glyphs() {
        let font = load_font(Path::new(r"C:\Windows\Fonts\msgothic.ttc"))
            .expect("MS Gothic is preinstalled on Windows");
        let png = red_png(200, 60);
        let edits = [PageEdit {
            rect: rect(10.0, 10.0, 180.0, 40.0),
            style: EditStyle::ReplaceText {
                text: "開発会社A".to_string(),
                align: TextAlign::Center,
            },
        }];

        let out = decode(&apply_edits(&png, &edits, Some(&font)).unwrap());

        let region_pixels: Vec<_> = (10..190)
            .flat_map(|x| (10..50).map(move |y| (x, y)))
            .map(|(x, y)| *out.get_pixel(x, y))
            .collect();
        assert!(region_pixels.iter().all(|pixel| *pixel != RED));
        assert!(region_pixels.iter().any(|pixel| pixel.0[0] < 128));
    }

    /// Column of the leftmost dark (glyph) pixel drawn for `text` in a wide
    /// box under `align`, or None if nothing was drawn.
    fn leftmost_glyph_x(align: TextAlign, font: &FontVec) -> Option<u32> {
        let png = red_png(200, 40);
        let edits = [PageEdit {
            rect: rect(0.0, 0.0, 200.0, 40.0),
            style: EditStyle::ReplaceText {
                text: "AB".to_string(),
                align,
            },
        }];
        let out = decode(&apply_edits(&png, &edits, Some(font)).unwrap());
        (0..200).find(|&x| (0..40).any(|y| out.get_pixel(x, y).0[0] < 128))
    }

    #[test]
    fn alignment_places_short_replacement_at_the_chosen_edge() {
        let font = load_font(Path::new(r"C:\Windows\Fonts\msgothic.ttc"))
            .expect("MS Gothic is preinstalled on Windows");

        let left = leftmost_glyph_x(TextAlign::Left, &font).unwrap();
        let center = leftmost_glyph_x(TextAlign::Center, &font).unwrap();
        let right = leftmost_glyph_x(TextAlign::Right, &font).unwrap();

        assert!(left < center, "left {left} not left of center {center}");
        assert!(center < right, "center {center} not left of right {right}");
        assert!(left < 10, "left-aligned text should hug the left edge: {left}");
    }
}
