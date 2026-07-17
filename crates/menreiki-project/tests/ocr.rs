use std::fs;

use menreiki_core::{OcrLine, PageOcr};
use menreiki_ocr::{OcrEngine, OcrError};
use menreiki_project::{
    import, ocr_pages, page_image_path, page_ocr_path, OcrPagesError, PAGES_DIR,
};

struct FakeOcrEngine;

impl OcrEngine for FakeOcrEngine {
    fn recognize(&self, png: &[u8]) -> Result<PageOcr, OcrError> {
        Ok(PageOcr {
            width: 1,
            height: 1,
            lines: vec![OcrLine {
                text: format!("recognized {} bytes", png.len()),
                words: vec![],
            }],
        })
    }
}

fn project_with_pages(tmp: &tempfile::TempDir, page_pngs: &[&[u8]]) -> std::path::PathBuf {
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("spec.menreiki");
    import(&input, &project_dir).unwrap();
    fs::create_dir_all(project_dir.join(PAGES_DIR)).unwrap();
    for (index, png) in page_pngs.iter().enumerate() {
        fs::write(page_image_path(&project_dir, index as u16), png).unwrap();
    }
    project_dir
}

#[test]
fn writes_one_ocr_json_per_page() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = project_with_pages(&tmp, &[b"png-one", b"png-two"]);

    let page_count = ocr_pages(&project_dir, &FakeOcrEngine, false, &mut |_, _| true).unwrap();

    assert_eq!(page_count, 2);
    let first: PageOcr =
        serde_json::from_str(&fs::read_to_string(page_ocr_path(&project_dir, 0)).unwrap())
            .unwrap();
    assert_eq!(first.text(), "recognized 7 bytes");
    assert!(page_ocr_path(&project_dir, 1).exists());
}

#[test]
fn project_without_rendered_pages_yields_zero() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = project_with_pages(&tmp, &[]);

    let page_count = ocr_pages(&project_dir, &FakeOcrEngine, false, &mut |_, _| true).unwrap();

    assert_eq!(page_count, 0);
}

#[test]
fn ocr_resume_skips_pages_that_already_have_results() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = project_with_pages(&tmp, &[b"png-one", b"png-two"]);
    fs::create_dir_all(page_ocr_path(&project_dir, 0).parent().unwrap()).unwrap();
    fs::write(page_ocr_path(&project_dir, 0), "{\"from\":\"previous\"}").unwrap();

    let page_count = ocr_pages(&project_dir, &FakeOcrEngine, true, &mut |_, _| true).unwrap();

    assert_eq!(page_count, 2);
    assert_eq!(
        fs::read_to_string(page_ocr_path(&project_dir, 0)).unwrap(),
        "{\"from\":\"previous\"}"
    );
    assert!(page_ocr_path(&project_dir, 1).exists());
}

#[test]
fn ocr_cancel_keeps_finished_pages() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = project_with_pages(&tmp, &[b"png-one", b"png-two"]);

    let cancel_after_first_page = &mut |_: u16, _: u16| false;
    let result = ocr_pages(&project_dir, &FakeOcrEngine, false, cancel_after_first_page);

    assert!(matches!(result, Err(OcrPagesError::Cancelled)));
    assert!(page_ocr_path(&project_dir, 0).exists());
    assert!(!page_ocr_path(&project_dir, 1).exists());
}
