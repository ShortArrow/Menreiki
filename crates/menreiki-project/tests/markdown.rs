use std::fs;

use menreiki_core::{OcrLine, PageOcr, Rect, Span};
use menreiki_ocr::{OcrEngine, OcrError};
use menreiki_project::{
    export_markdown, import, page_image_path, page_render_path, render_markdown, PAGES_DIR,
    RENDERS_DIR,
};

fn line_at(text: &str, y: f32, height: f32) -> OcrLine {
    OcrLine {
        text: text.to_string(),
        words: vec![Span {
            text: text.to_string(),
            rect: Rect {
                x: 10.0,
                y,
                width: 400.0,
                height,
            },
        }],
    }
}

#[test]
fn markdown_reconstructs_headings_paragraphs_and_bullets() {
    let page = PageOcr {
        width: 1000,
        height: 1000,
        lines: vec![
            line_at("評価試験報告書", 40.0, 40.0),
            line_at("本書は評価試験の結果を報告する。", 120.0, 20.0),
            line_at("試験は所定の手順で実施した。", 145.0, 20.0),
            line_at("・応答時間は基準を満たした", 220.0, 20.0),
            line_at("・連続稼働に異常はなかった", 245.0, 20.0),
        ],
    };

    let markdown = render_markdown(&[page]);

    let expected = "## ページ 1\n\n\
### 評価試験報告書\n\n\
本書は評価試験の結果を報告する。\n\
試験は所定の手順で実施した。\n\n\
- 応答時間は基準を満たした\n\
- 連続稼働に異常はなかった\n";
    assert_eq!(markdown, expected);
}

#[test]
fn markdown_numbers_every_page() {
    let page = |text: &str| PageOcr {
        width: 100,
        height: 100,
        lines: vec![line_at(text, 10.0, 10.0)],
    };

    let markdown = render_markdown(&[page("一枚目"), page("二枚目")]);

    assert!(markdown.contains("## ページ 1"));
    assert!(markdown.contains("## ページ 2"));
    assert!(markdown.contains("一枚目"));
    assert!(markdown.contains("二枚目"));
}

struct EchoOcr;

impl OcrEngine for EchoOcr {
    fn recognize(&self, png: &[u8]) -> Result<PageOcr, OcrError> {
        Ok(PageOcr {
            width: 100,
            height: 100,
            lines: vec![line_at(&String::from_utf8_lossy(png), 10.0, 10.0)],
        })
    }
}

#[test]
fn export_markdown_reads_transformed_pages_not_originals() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("spec.menreiki");
    import(&input, &project_dir).unwrap();
    fs::create_dir_all(project_dir.join(PAGES_DIR)).unwrap();
    fs::create_dir_all(project_dir.join(RENDERS_DIR)).unwrap();
    fs::write(page_image_path(&project_dir, 0), b"original secret page").unwrap();
    fs::write(page_render_path(&project_dir, 0), b"sanitized page").unwrap();

    let output = export_markdown(&project_dir, &EchoOcr, &mut |_, _| {}).unwrap();

    let markdown = fs::read_to_string(output).unwrap();
    assert!(markdown.contains("sanitized page"));
    assert!(!markdown.contains("original secret page"));
}
