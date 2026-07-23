use std::fs;

use menreiki_core::{Finding, PageOcr, Rect};
use menreiki_project::{detect_pages, load_findings, page_findings_path, page_ocr_path};

/// "ここを検出" pins a reviewer-asserted candidate at the exact box they drew.
/// Re-running detection rewrites the findings file; the manual entry must be
/// carried over while stale automatic findings are replaced.
#[test]
fn manual_findings_survive_re_detection() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    fs::create_dir_all(page_ocr_path(dir, 0).parent().unwrap()).unwrap();
    let ocr = PageOcr {
        width: 100,
        height: 100,
        lines: vec![],
    };
    fs::write(page_ocr_path(dir, 0), serde_json::to_string(&ocr).unwrap()).unwrap();

    fs::create_dir_all(page_findings_path(dir, 0).parent().unwrap()).unwrap();
    let existing = vec![
        Finding {
            category: "organization".to_string(),
            text: "犬芝重工業株式会社".to_string(),
            rect: Rect {
                x: 10.0,
                y: 10.0,
                width: 80.0,
                height: 20.0,
            },
            detector: "manual".to_string(),
            note: Some("手動指定（ここを検出）".to_string()),
        },
        Finding {
            category: "phone".to_string(),
            text: "stale-automatic".to_string(),
            rect: Rect {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
            detector: "regex".to_string(),
            note: None,
        },
    ];
    fs::write(
        page_findings_path(dir, 0),
        serde_json::to_string(&existing).unwrap(),
    )
    .unwrap();

    detect_pages(dir, &[]).unwrap();

    let pages = load_findings(dir).unwrap();
    let texts: Vec<&str> = pages[0]
        .findings
        .iter()
        .map(|finding| finding.text.as_str())
        .collect();
    assert!(texts.contains(&"犬芝重工業株式会社"), "manual finding lost: {texts:?}");
    assert!(!texts.contains(&"stale-automatic"), "stale finding kept: {texts:?}");
    let manual = pages[0]
        .findings
        .iter()
        .filter(|finding| finding.detector == "manual")
        .count();
    assert_eq!(manual, 1);
}
