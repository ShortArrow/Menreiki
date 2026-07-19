use std::fs;

use menreiki_core::{OcrLine, PageOcr, Rect, Span};
use menreiki_inference::{
    CandidateDetector, ImageCandidateDetector, InferenceError, LlmCandidate,
};
use menreiki_project::{
    import, llm_detect_pages, load_findings, page_findings_path, page_image_path, page_ocr_path,
    vlm_detect_pages, OCR_DIR, PAGES_DIR,
};

struct FakeDetector;

impl CandidateDetector for FakeDetector {
    fn detect(&self, _page_text: &str) -> Result<Vec<LlmCandidate>, InferenceError> {
        Ok(vec![
            LlmCandidate {
                category: "organization".to_string(),
                text: "ガンマ電子工業".to_string(),
                reason: "文脈から取引先の社名と思われる".to_string(),
            },
            LlmCandidate {
                category: "person".to_string(),
                text: "存在しない架空の文字列".to_string(),
                reason: "モデルの言い換えや幻覚".to_string(),
            },
        ])
    }
}

#[test]
fn model_candidates_are_located_merged_and_hallucinations_dropped() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("spec.menreiki");
    import(&input, &project_dir).unwrap();
    fs::create_dir_all(project_dir.join(OCR_DIR)).unwrap();
    let page = PageOcr {
        width: 1000,
        height: 100,
        lines: vec![OcrLine {
            text: "納入元はガンマ電子工業とする".to_string(),
            words: vec![Span {
                text: "納入元はガンマ電子工業とする".to_string(),
                rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 500.0,
                    height: 20.0,
                },
            }],
        }],
    };
    fs::write(
        page_ocr_path(&project_dir, 0),
        serde_json::to_string(&page).unwrap(),
    )
    .unwrap();

    let pages = llm_detect_pages(&project_dir, &FakeDetector, &mut |_, _| true).unwrap();

    assert_eq!(pages, 1);
    let findings = load_findings(&project_dir).unwrap();
    let llm: Vec<_> = findings[0]
        .findings
        .iter()
        .filter(|finding| finding.detector == "llm")
        .collect();
    assert_eq!(llm.len(), 1);
    assert_eq!(llm[0].text, "ガンマ電子工業");
    assert_eq!(
        llm[0].note.as_deref(),
        Some("文脈から取引先の社名と思われる")
    );

    // Re-running must not duplicate what is already recorded.
    llm_detect_pages(&project_dir, &FakeDetector, &mut |_, _| true).unwrap();
    let findings = load_findings(&project_dir).unwrap();
    let llm_count = findings[0]
        .findings
        .iter()
        .filter(|finding| finding.detector == "llm")
        .count();
    assert_eq!(llm_count, 1);
    assert!(page_findings_path(&project_dir, 0).exists());
}

struct FakeImageDetector;

impl ImageCandidateDetector for FakeImageDetector {
    fn detect_image(&self, _png: &[u8]) -> Result<Vec<LlmCandidate>, InferenceError> {
        Ok(vec![
            LlmCandidate {
                category: "organization".to_string(),
                text: "ガンマ電子工業".to_string(),
                reason: "本文の社名".to_string(),
            },
            LlmCandidate {
                category: "other".to_string(),
                text: "社外秘".to_string(),
                reason: "図中の透かしに見える".to_string(),
            },
        ])
    }
}

#[test]
fn vlm_candidates_missing_from_ocr_become_whole_page_findings() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("spec.menreiki");
    import(&input, &project_dir).unwrap();
    fs::create_dir_all(project_dir.join(OCR_DIR)).unwrap();
    fs::create_dir_all(project_dir.join(PAGES_DIR)).unwrap();
    let page = PageOcr {
        width: 1000,
        height: 800,
        lines: vec![OcrLine {
            text: "納入元はガンマ電子工業とする".to_string(),
            words: vec![Span {
                text: "納入元はガンマ電子工業とする".to_string(),
                rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 500.0,
                    height: 20.0,
                },
            }],
        }],
    };
    fs::write(
        page_ocr_path(&project_dir, 0),
        serde_json::to_string(&page).unwrap(),
    )
    .unwrap();
    fs::write(page_image_path(&project_dir, 0), b"fake png").unwrap();

    vlm_detect_pages(&project_dir, &FakeImageDetector, &mut |_, _| true).unwrap();

    let findings = load_findings(&project_dir).unwrap();
    let located = findings[0]
        .findings
        .iter()
        .find(|finding| finding.text == "ガンマ電子工業")
        .expect("OCR-visible candidate should be located");
    assert_eq!(located.detector, "vlm");
    assert!(located.rect.width < 1000.0);

    let unlocated = findings[0]
        .findings
        .iter()
        .find(|finding| finding.text == "社外秘")
        .expect("image-only candidate should be kept");
    assert_eq!(unlocated.rect.width, 1000.0);
    assert_eq!(unlocated.rect.height, 800.0);
    assert!(unlocated.note.as_deref().unwrap().starts_with("位置未特定"));
}
