use std::io::Cursor;
use std::path::{Path, PathBuf};

use image::{Rgba, RgbaImage};
use menreiki_adapter_pdfium::PdfiumRasterizer;
use menreiki_render::{build_image_pdf, DocumentRasterizer};

fn pdfium_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("vendor")
        .join("pdfium")
}

#[test]
fn rebuilt_pdf_renders_back_to_the_same_pixels() {
    let source = RgbaImage::from_pixel(300, 300, Rgba([200, 0, 0, 255]));
    let mut png = Vec::new();
    image::DynamicImage::ImageRgba8(source)
        .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
        .unwrap();
    let pdf = build_image_pdf(&[png], 300).unwrap();

    let rasterizer = PdfiumRasterizer::new(&pdfium_dir())
        .expect("pdfium.dll not found; run scripts/fetch-pdfium.ps1 first");
    let mut pages = Vec::new();
    let page_count = rasterizer
        .rasterize(&pdf, 300, &mut |_, image| {
            pages.push(image);
            Ok(())
        })
        .unwrap();

    assert_eq!(page_count, 1);
    let rendered = image::load_from_memory(&pages[0].png).unwrap().into_rgba8();
    let center = *rendered.get_pixel(rendered.width() / 2, rendered.height() / 2);
    assert!(center.0[0] > 150, "expected red channel, got {center:?}");
    assert!(center.0[1] < 80, "expected low green channel, got {center:?}");
}
