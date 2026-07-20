use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::fs;

use image::{Rgba, RgbaImage};
use menreiki_core::{OcrLine, PageOcr, Rect, Span};
use menreiki_lang_ja::builtin_rules;
use menreiki_policy::parse_policy;
use menreiki_project::{
    apply, detect_pages, import, page_image_path, page_ocr_path, page_render_path, plan_path,
    OCR_DIR, PAGES_DIR,
};

const RED: Rgba<u8> = Rgba([200, 0, 0, 255]);
const WHITE: Rgba<u8> = Rgba([255, 255, 255, 255]);
const BLACK: Rgba<u8> = Rgba([0, 0, 0, 255]);

fn red_png(width: u32, height: u32) -> Vec<u8> {
    let image = RgbaImage::from_pixel(width, height, RED);
    let mut png = Vec::new();
    image::DynamicImage::ImageRgba8(image)
        .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
        .unwrap();
    png
}

fn page_ocr(line_text: &str, word: &str, rect: Rect) -> PageOcr {
    PageOcr {
        width: 100,
        height: 100,
        lines: vec![OcrLine {
            text: line_text.to_string(),
            words: vec![Span {
                text: word.to_string(),
                rect,
            }],
        }],
    }
}

fn project_fixture(tmp: &tempfile::TempDir) -> PathBuf {
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("spec.menreiki");
    import(&input, &project_dir).unwrap();

    fs::create_dir_all(project_dir.join(PAGES_DIR)).unwrap();
    fs::create_dir_all(project_dir.join(OCR_DIR)).unwrap();
    for (index, ocr) in [
        page_ocr(
            "taro@example.com",
            "taro@example.com",
            Rect {
                x: 10.0,
                y: 10.0,
                width: 60.0,
                height: 10.0,
            },
        ),
        page_ocr(
            "clean page",
            "clean",
            Rect {
                x: 10.0,
                y: 40.0,
                width: 30.0,
                height: 10.0,
            },
        ),
    ]
    .iter()
    .enumerate()
    {
        fs::write(page_image_path(&project_dir, index as u16), red_png(100, 100)).unwrap();
        fs::write(
            page_ocr_path(&project_dir, index as u16),
            serde_json::to_string(ocr).unwrap(),
        )
        .unwrap();
    }
    detect_pages(&project_dir, &builtin_rules()).unwrap();
    project_dir
}

fn pixel(path: &Path, x: u32, y: u32) -> Rgba<u8> {
    let image = image::open(path).unwrap().into_rgba8();
    *image.get_pixel(x, y)
}

#[test]
fn apply_masks_findings_and_erases_region_on_all_pages() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = project_fixture(&tmp);
    let policy = parse_policy(
        r"
rules:
  - match: { category: email }
    action: { type: mask }
  - match:
      region: { x: 0, y: 80, width: 100, height: 20 }
      pages: all
    action: { type: remove }
",
    )
    .unwrap();

    let summary = apply(&project_dir, &policy, Path::new("unused-font")).unwrap();

    assert_eq!(summary.page_count, 2);
    assert_eq!(summary.edit_count, 3);
    assert!(plan_path(&project_dir).exists());

    let first = page_render_path(&project_dir, 0);
    assert_eq!(pixel(&first, 30, 15), BLACK);
    assert_eq!(pixel(&first, 50, 90), WHITE);
    assert_eq!(pixel(&first, 50, 50), RED);

    let second = page_render_path(&project_dir, 1);
    assert_eq!(pixel(&second, 50, 90), WHITE);
    assert_eq!(pixel(&second, 50, 50), RED);
}

#[test]
fn apply_replaces_text_using_a_real_font() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = project_fixture(&tmp);
    let policy = parse_policy(
        r"
rules:
  - match: { text: taro@example.com }
    action: { type: replace, value: mail-A }
",
    )
    .unwrap();

    let summary = apply(
        &project_dir,
        &policy,
        Path::new(r"C:\Windows\Fonts\msgothic.ttc"),
    )
    .unwrap();

    assert_eq!(summary.edit_count, 1);
    let first = page_render_path(&project_dir, 0);
    let image = image::open(&first).unwrap().into_rgba8();
    let mut region = Vec::new();
    for x in 10..70 {
        for y in 10..20 {
            region.push(*image.get_pixel(x, y));
        }
    }
    assert!(region.iter().all(|p| *p != RED));
    assert!(region.iter().any(|p| p.0[0] < 128));
}
