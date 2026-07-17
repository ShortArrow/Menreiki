use std::path::{Path, PathBuf};

use menreiki_adapter_pdfium::PdfiumRasterizer;
use menreiki_render::{DocumentRasterizer, PageImage};
use menreiki_test_support::minimal_pdf;

const PNG_SIGNATURE: [u8; 8] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

fn pdfium_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("vendor")
        .join("pdfium")
}

fn rasterizer() -> PdfiumRasterizer {
    PdfiumRasterizer::new(&pdfium_dir())
        .expect("pdfium.dll not found; run scripts/fetch-pdfium.ps1 first")
}

#[test]
fn rasterizes_every_page_at_requested_dpi() {
    let document = minimal_pdf(2);
    let mut pages: Vec<(u16, PageImage)> = Vec::new();

    let page_count = rasterizer()
        .rasterize(&document, 300, &mut |index, image| {
            pages.push((index, image));
            Ok(())
        })
        .unwrap();

    assert_eq!(page_count, 2);
    assert_eq!(pages.len(), 2);
    let (index, first) = &pages[0];
    assert_eq!(*index, 0);
    assert!(
        (2548..=2552).contains(&first.width),
        "612pt at 300dpi should be about 2550px, got {}",
        first.width
    );
    assert!(
        (3298..=3302).contains(&first.height),
        "792pt at 300dpi should be about 3300px, got {}",
        first.height
    );
    assert_eq!(first.png[..8], PNG_SIGNATURE);
}

#[test]
fn rejects_non_pdf_bytes() {
    let result = rasterizer().rasterize(b"not a pdf", 300, &mut |_, _| Ok(()));

    assert!(result.is_err());
}
