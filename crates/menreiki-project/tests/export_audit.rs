use std::fs;
use std::io::Cursor;
use std::path::PathBuf;

use image::{Rgba, RgbaImage};
use menreiki_audit::Verdict;
use menreiki_core::{OcrLine, PageOcr, Rect, Span};
use menreiki_ocr::{OcrEngine, OcrError};
use menreiki_policy::parse_policy;
use menreiki_project::{
    audit_output, audit_report_path, export_pdf, import, page_render_path, RENDERS_DIR,
};

fn red_png(width: u32, height: u32) -> Vec<u8> {
    let image = RgbaImage::from_pixel(width, height, Rgba([200, 0, 0, 255]));
    let mut png = Vec::new();
    image::DynamicImage::ImageRgba8(image)
        .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
        .unwrap();
    png
}

fn project_with_renders(tmp: &tempfile::TempDir, page_count: u16) -> PathBuf {
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("spec.menreiki");
    import(&input, &project_dir).unwrap();
    fs::create_dir_all(project_dir.join(RENDERS_DIR)).unwrap();
    for index in 0..page_count {
        fs::write(page_render_path(&project_dir, index), red_png(100, 100)).unwrap();
    }
    project_dir
}

struct FixedTextOcr {
    per_page: Vec<String>,
    calls: std::cell::Cell<usize>,
}

impl OcrEngine for FixedTextOcr {
    fn recognize(&self, _png: &[u8]) -> Result<PageOcr, OcrError> {
        let index = self.calls.get();
        self.calls.set(index + 1);
        let text = self.per_page[index].clone();
        Ok(PageOcr {
            width: 100,
            height: 100,
            lines: vec![OcrLine {
                text: text.clone(),
                words: vec![Span {
                    text,
                    rect: Rect {
                        x: 1.0,
                        y: 1.0,
                        width: 10.0,
                        height: 5.0,
                    },
                }],
            }],
        })
    }
}

#[test]
fn export_builds_sanitized_pdf_from_renders() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = project_with_renders(&tmp, 2);

    let output = export_pdf(&project_dir, 300, None).unwrap();

    let bytes = fs::read(output).unwrap();
    assert!(bytes.starts_with(b"%PDF-1.4"));
    assert!(String::from_utf8_lossy(&bytes[..1000]).contains("/Count 2"));
}

#[test]
fn export_includes_only_the_selected_pages() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = project_with_renders(&tmp, 3);

    // Keep only pages 1 and 3 (0-based 0 and 2).
    let output = export_pdf(&project_dir, 300, Some(&[0, 2])).unwrap();

    let bytes = fs::read(output).unwrap();
    assert!(String::from_utf8_lossy(&bytes[..1000]).contains("/Count 2"));
}

#[test]
fn export_with_an_empty_selection_is_no_pages() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = project_with_renders(&tmp, 2);

    assert!(export_pdf(&project_dir, 300, Some(&[])).is_err());
}

#[test]
fn audit_fails_when_a_denied_term_is_still_readable() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = project_with_renders(&tmp, 2);
    let engine = FixedTextOcr {
        per_page: vec!["clean page".to_string(), "call 株式会社アルファ".to_string()],
        calls: std::cell::Cell::new(0),
    };

    let report = audit_output(
        &project_dir,
        None,
        &["株式会社アルファ".to_string()],
        &engine,
    )
    .unwrap();

    assert_eq!(report.verdict, Verdict::Fail);
    assert_eq!(report.residuals.len(), 1);
    assert_eq!(report.residuals[0].page, 2);
    assert!(audit_report_path(&project_dir).exists());
}

#[test]
fn audit_passes_when_terms_are_gone_and_uses_policy_terms() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = project_with_renders(&tmp, 1);
    let policy = parse_policy(
        "rules:\n  - match: { text: 株式会社アルファ }\n    action: { type: replace, value: 開発会社A }\n",
    )
    .unwrap();
    let engine = FixedTextOcr {
        per_page: vec!["開発会社Aの資料".to_string()],
        calls: std::cell::Cell::new(0),
    };

    let report = audit_output(&project_dir, Some(&policy), &[], &engine).unwrap();

    assert_eq!(report.verdict, Verdict::Pass);
    assert_eq!(report.checked_terms, 1);
}
