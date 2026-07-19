use std::path::{Path, PathBuf};

use menreiki_adapter_pdfium::PdfiumRasterizer;
use menreiki_render::DocumentRasterizer;
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
fn reports_page_count_and_rasterizes_each_page_at_requested_dpi() {
    let document = minimal_pdf(2);
    let rasterizer = rasterizer();

    let page_count = rasterizer.page_count(&document).unwrap();
    assert_eq!(page_count, 2);

    let first = rasterizer.rasterize_page(&document, 0, 300).unwrap();
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

    let second = rasterizer.rasterize_page(&document, 1, 300).unwrap();
    assert_eq!(second.png[..8], PNG_SIGNATURE);
}

#[test]
fn rejects_non_pdf_bytes() {
    assert!(rasterizer().page_count(b"not a pdf").is_err());
    assert!(rasterizer().rasterize_page(b"not a pdf", 0, 300).is_err());
}

#[test]
fn rejects_out_of_range_page_index() {
    let document = minimal_pdf(1);

    assert!(rasterizer().rasterize_page(&document, 5, 300).is_err());
}

#[test]
fn embedded_library_extracts_once_into_a_content_addressed_dir() {
    let tmp = tempfile::tempdir().unwrap();
    let bytes = b"not a real dll, but content is content";

    let first = menreiki_adapter_pdfium::install_embedded(bytes, tmp.path()).unwrap();
    let second = menreiki_adapter_pdfium::install_embedded(bytes, tmp.path()).unwrap();

    assert_eq!(first, second);
    assert_eq!(std::fs::read(first.join("pdfium.dll")).unwrap(), bytes);
    let other = menreiki_adapter_pdfium::install_embedded(b"different", tmp.path()).unwrap();
    assert_ne!(first, other);
}
