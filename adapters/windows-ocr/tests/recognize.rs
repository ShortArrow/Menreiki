use std::path::{Path, PathBuf};

use menreiki_adapter_windows_ocr::WindowsOcrEngine;
use menreiki_ocr::OcrEngine;

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("test-documents")
        .join(name)
}

#[test]
fn recognizes_text_in_fixture_image() {
    let png = std::fs::read(fixture("ocr-hello.png"))
        .expect("fixture missing; run scripts/make-test-documents.ps1 first");
    let engine = WindowsOcrEngine::from_user_profile_languages()
        .expect("Windows OCR engine unavailable");

    let page = engine.recognize(&png).unwrap();

    assert_eq!(page.width, 400);
    assert_eq!(page.height, 120);
    let text = page.text().to_uppercase();
    assert!(text.contains("HELLO"), "recognized text was: {text}");
    assert!(text.contains("123"), "recognized text was: {text}");
    let first_word = &page.lines[0].words[0];
    assert!(first_word.rect.width > 0.0);
    assert!(first_word.rect.x < page.width as f32);
}

#[test]
fn japanese_engine_recognizes_japanese_text() {
    let png = std::fs::read(fixture("ocr-japanese.png"))
        .expect("fixture missing; run scripts/make-test-documents.ps1 first");
    let engine = WindowsOcrEngine::from_language("ja")
        .expect("Japanese OCR language pack unavailable");

    let page = engine.recognize(&png).unwrap();

    let text = page.text();
    assert!(text.contains("株式会社"), "recognized text was: {text}");
}

#[test]
fn rejects_non_png_bytes() {
    let engine = WindowsOcrEngine::from_user_profile_languages()
        .expect("Windows OCR engine unavailable");

    let result = engine.recognize(b"not a png");

    assert!(result.is_err());
}
