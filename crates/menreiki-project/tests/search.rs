use std::fs;

use menreiki_core::{OcrLine, PageOcr, Rect, Span};
use menreiki_project::{import, page_ocr_path, search_text, OCR_DIR};

fn page_with_line(text: &str) -> PageOcr {
    PageOcr {
        width: 1000,
        height: 1000,
        lines: vec![OcrLine {
            text: text.to_string(),
            words: vec![Span {
                text: text.to_string(),
                rect: Rect {
                    x: 10.0,
                    y: 10.0,
                    width: 200.0,
                    height: 20.0,
                },
            }],
        }],
    }
}

#[test]
fn search_enumerates_matches_across_pages() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("spec.menreiki");
    import(&input, &project_dir).unwrap();
    fs::create_dir_all(project_dir.join(OCR_DIR)).unwrap();
    let pages = [
        page_with_line("納入元は株式会社アルファです"),
        page_with_line("無関係なページ"),
        page_with_line("株式会社アルファの担当者"),
    ];
    for (index, page) in pages.iter().enumerate() {
        fs::write(
            page_ocr_path(&project_dir, index as u16),
            serde_json::to_string(page).unwrap(),
        )
        .unwrap();
    }

    let results = search_text(&project_dir, "株式会社アルファ").unwrap();

    assert_eq!(results.len(), 3);
    assert_eq!(results[0].findings.len(), 1);
    assert_eq!(results[0].findings[0].text, "株式会社アルファ");
    assert_eq!(results[0].findings[0].category, "search");
    assert!(results[1].findings.is_empty());
    assert_eq!(results[2].findings.len(), 1);
}
