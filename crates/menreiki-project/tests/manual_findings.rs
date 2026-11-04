use std::fs;

use menreiki_core::{Finding, PageOcr, Rect};
use menreiki_policy::{parse_policy, plan_page_edits};
use menreiki_project::{
    add_manual_finding, detect_pages, load_findings, page_findings_path, page_ocr_path,
};

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
            unlocated: false,
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
            unlocated: false,
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

const NAME: &str = "株式会社サンプル精機";

fn rect(x: f32, y: f32, width: f32, height: f32) -> Rect {
    Rect {
        x,
        y,
        width,
        height,
    }
}

/// A one-page project whose OCR never read `NAME`, with `existing` already
/// stored as that page's findings.
fn project_with_findings(existing: &[Finding]) -> (tempfile::TempDir, PageOcr) {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    let ocr = PageOcr {
        width: 1000,
        height: 800,
        lines: vec![],
    };
    fs::create_dir_all(page_ocr_path(dir, 0).parent().unwrap()).unwrap();
    fs::write(page_ocr_path(dir, 0), serde_json::to_string(&ocr).unwrap()).unwrap();
    fs::create_dir_all(page_findings_path(dir, 0).parent().unwrap()).unwrap();
    fs::write(
        page_findings_path(dir, 0),
        serde_json::to_string(existing).unwrap(),
    )
    .unwrap();
    (tmp, ocr)
}

fn mask_rects(dir: &std::path::Path, ocr: &PageOcr) -> Vec<Rect> {
    let policy = parse_policy(&format!(
        "rules:\n  - match: {{ text: {NAME} }}\n    action: {{ type: mask }}\n"
    ))
    .unwrap();
    let findings: Vec<Vec<Finding>> = load_findings(dir)
        .unwrap()
        .into_iter()
        .map(|page| page.findings)
        .collect();
    let plans = plan_page_edits(&policy, std::slice::from_ref(ocr), &findings).unwrap();
    plans[0].iter().map(|edit| edit.rect).collect()
}

/// The help tells the reviewer to box a location-unknown VLM candidate with
/// "Detect here" and assign it to the group; that box must be stored, not
/// swallowed as a duplicate of the whole-page placeholder.
#[test]
fn boxing_a_location_unknown_candidate_stores_the_box() {
    let (tmp, ocr) = project_with_findings(&[Finding {
        category: "organization".to_string(),
        text: NAME.to_string(),
        rect: rect(0.0, 0.0, 1000.0, 800.0),
        detector: "vlm".to_string(),
        note: None,
        unlocated: true,
    }]);
    let dir = tmp.path();
    let boxed = rect(100.0, 200.0, 240.0, 30.0);

    add_manual_finding(dir, 0, boxed, "organization", NAME).unwrap();

    let pages = load_findings(dir).unwrap();
    assert_eq!(pages[0].findings.len(), 2, "{:?}", pages[0].findings);
    assert!(pages[0]
        .findings
        .iter()
        .any(|f| f.detector == "vlm" && f.unlocated));
    assert!(pages[0]
        .findings
        .iter()
        .any(|f| f.detector == "manual" && f.rect == boxed && !f.unlocated));
    assert_eq!(mask_rects(dir, &ocr), vec![boxed]);
}

/// A second occurrence of an already located text on the same page is a new
/// position, not a duplicate.
#[test]
fn boxing_a_second_occurrence_on_the_same_page_keeps_both() {
    let first = rect(10.0, 10.0, 240.0, 30.0);
    let (tmp, ocr) = project_with_findings(&[Finding {
        category: "organization".to_string(),
        text: NAME.to_string(),
        rect: first,
        detector: "dictionary".to_string(),
        note: None,
        unlocated: false,
    }]);
    let dir = tmp.path();
    let second = rect(500.0, 600.0, 240.0, 30.0);

    add_manual_finding(dir, 0, second, "organization", NAME).unwrap();

    let pages = load_findings(dir).unwrap();
    assert_eq!(pages[0].findings.len(), 2, "{:?}", pages[0].findings);
    let edited = mask_rects(dir, &ocr);
    assert_eq!(edited.len(), 2, "{edited:?}");
    assert!(edited.contains(&first));
    assert!(edited.contains(&second));
}

#[test]
fn adding_the_same_box_twice_stores_it_once() {
    let (tmp, _ocr) = project_with_findings(&[]);
    let dir = tmp.path();
    let boxed = rect(100.0, 200.0, 240.0, 30.0);

    add_manual_finding(dir, 0, boxed, "organization", NAME).unwrap();
    add_manual_finding(dir, 0, boxed, "organization", NAME).unwrap();

    let pages = load_findings(dir).unwrap();
    assert_eq!(pages[0].findings.len(), 1, "{:?}", pages[0].findings);
}

/// Projects written before the structured flag encoded the status in `note`;
/// reading them back moves it into `unlocated` and keeps only the reason.
#[test]
fn legacy_note_encoded_unlocated_findings_are_upgraded_on_load() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    fs::create_dir_all(page_findings_path(dir, 0).parent().unwrap()).unwrap();
    let legacy = r#"[
  {"category":"other","text":"社外秘","rect":{"x":0,"y":0,"width":1000,"height":800},
   "detector":"vlm","note":"位置未特定: 理由X"},
  {"category":"organization","text":"株式会社サンプル精機","rect":{"x":0,"y":0,"width":1000,"height":800},
   "detector":"vlm","note":"位置未特定（画像内で検出）"},
  {"category":"organization","text":"ガンマ電子工業","rect":{"x":1,"y":2,"width":3,"height":4},
   "detector":"vlm","note":"本文の社名"}
]"#;
    fs::write(page_findings_path(dir, 0), legacy).unwrap();

    let pages = load_findings(dir).unwrap();
    let findings = &pages[0].findings;
    assert!(findings[0].unlocated);
    assert_eq!(findings[0].note.as_deref(), Some("理由X"));
    assert!(findings[1].unlocated);
    assert_eq!(findings[1].note, None);
    assert!(!findings[2].unlocated);
    assert_eq!(findings[2].note.as_deref(), Some("本文の社名"));
}
