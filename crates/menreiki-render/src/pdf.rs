use std::io::Write;

use flate2::write::ZlibEncoder;
use flate2::Compression;

#[derive(Debug, thiserror::Error)]
pub enum PdfBuildError {
    #[error("at least one page image is required")]
    NoPages,
    #[error("page image could not be decoded: {0}")]
    Decode(String),
}

/// Builds a brand-new PDF containing only the supplied PNG page images.
///
/// The document is constructed from pixels alone, so nothing from any
/// source PDF — text layers, metadata, annotations, attachments, scripts,
/// hidden layers — can survive into it. `dpi` maps pixel dimensions back to
/// physical page size.
pub fn build_image_pdf(page_pngs: &[Vec<u8>], dpi: u32) -> Result<Vec<u8>, PdfBuildError> {
    if page_pngs.is_empty() {
        return Err(PdfBuildError::NoPages);
    }

    let mut objects: Vec<Vec<u8>> = Vec::new();
    objects.push(b"<< /Type /Catalog /Pages 2 0 R >>".to_vec());
    let kids: Vec<String> = (0..page_pngs.len())
        .map(|index| format!("{} 0 R", 3 + 3 * index))
        .collect();
    objects.push(
        format!(
            "<< /Type /Pages /Kids [{}] /Count {} >>",
            kids.join(" "),
            page_pngs.len()
        )
        .into_bytes(),
    );

    for (index, png) in page_pngs.iter().enumerate() {
        let rgb = image::load_from_memory_with_format(png, image::ImageFormat::Png)
            .map_err(|error| PdfBuildError::Decode(error.to_string()))?
            .into_rgb8();
        let (pixel_width, pixel_height) = rgb.dimensions();
        let point_width = pixel_width as f32 * 72.0 / dpi as f32;
        let point_height = pixel_height as f32 * 72.0 / dpi as f32;
        let page_object = 3 + 3 * index;
        let content_object = page_object + 1;
        let image_object = page_object + 2;

        objects.push(
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {point_width:.2} {point_height:.2}] \
                 /Resources << /XObject << /Im{index} {image_object} 0 R >> >> \
                 /Contents {content_object} 0 R >>"
            )
            .into_bytes(),
        );
        let content = format!("q {point_width:.2} 0 0 {point_height:.2} 0 0 cm /Im{index} Do Q");
        objects.push(stream_object(
            &format!("<< /Length {} >>", content.len()),
            content.as_bytes(),
        ));

        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder
            .write_all(rgb.as_raw())
            .expect("in-memory compression cannot fail");
        let compressed = encoder
            .finish()
            .expect("in-memory compression cannot fail");
        objects.push(stream_object(
            &format!(
                "<< /Type /XObject /Subtype /Image /Width {pixel_width} /Height {pixel_height} \
                 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length {} >>",
                compressed.len()
            ),
            &compressed,
        ));
    }

    Ok(assemble_pdf(&objects))
}

fn stream_object(dict: &str, data: &[u8]) -> Vec<u8> {
    let mut object = dict.as_bytes().to_vec();
    object.extend_from_slice(b"\nstream\n");
    object.extend_from_slice(data);
    object.extend_from_slice(b"\nendstream");
    object
}

fn assemble_pdf(objects: &[Vec<u8>]) -> Vec<u8> {
    let mut pdf: Vec<u8> = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (index, body) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.extend_from_slice(format!("{} 0 obj\n", index + 1).as_bytes());
        pdf.extend_from_slice(body);
        pdf.extend_from_slice(b"\nendobj\n");
    }
    let xref_offset = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n", objects.len() + 1).as_bytes());
    pdf.extend_from_slice(b"0000000000 65535 f \n");
    for offset in &offsets {
        pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n",
            objects.len() + 1
        )
        .as_bytes(),
    );
    pdf
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};
    use std::io::Cursor;

    fn png(width: u32, height: u32) -> Vec<u8> {
        let image = RgbaImage::from_pixel(width, height, Rgba([255, 0, 0, 255]));
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Png)
            .unwrap();
        bytes
    }

    #[test]
    fn builds_a_pdf_with_one_page_per_image() {
        let pdf = build_image_pdf(&[png(300, 300), png(300, 300)], 300).unwrap();

        let head = String::from_utf8_lossy(&pdf[..pdf.len().min(2000)]);
        assert!(head.starts_with("%PDF-1.4"));
        assert!(head.contains("/Count 2"));
        assert!(head.contains("/MediaBox [0 0 72.00 72.00]"));
        assert!(String::from_utf8_lossy(&pdf).contains("%%EOF"));
    }

    #[test]
    fn refuses_an_empty_document() {
        assert!(matches!(
            build_image_pdf(&[], 300),
            Err(PdfBuildError::NoPages)
        ));
    }
}
