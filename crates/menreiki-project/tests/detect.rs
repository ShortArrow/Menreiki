use std::fs;

use menreiki_core::{OcrLine, PageOcr, Rect, Span};
use menreiki_lang_ja::builtin_rules;
use menreiki_project::{
    detect_pages, import, load_findings, page_ocr_path, save_project_settings, IgnoreEntry,
    ProjectSettings, OCR_DIR,
};

fn project_with_ocr(tmp: &tempfile::TempDir, page_texts: &[&str]) -> std::path::PathBuf {
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("spec.menreiki");
    import(&input, &project_dir).unwrap();
    fs::create_dir_all(project_dir.join(OCR_DIR)).unwrap();
    for (index, text) in page_texts.iter().enumerate() {
        let page = PageOcr {
            width: 1000,
            height: 100,
            lines: vec![OcrLine {
                text: text.to_string(),
                words: vec![Span {
                    text: text.to_string(),
                    rect: Rect {
                        x: 0.0,
                        y: 0.0,
                        width: 100.0,
                        height: 20.0,
                    },
                }],
            }],
        };
        fs::write(
            page_ocr_path(&project_dir, index as u16),
            serde_json::to_string(&page).unwrap(),
        )
        .unwrap();
    }
    project_dir
}

#[test]
fn detects_and_reloads_findings_per_page() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = project_with_ocr(
        &tmp,
        &["mail taro@example.com", "nothing sensitive on this page"],
    );

    let page_count = detect_pages(&project_dir, &builtin_rules()).unwrap();

    assert_eq!(page_count, 2);
    let pages = load_findings(&project_dir).unwrap();
    assert_eq!(pages.len(), 2);
    assert_eq!(pages[0].findings.len(), 1);
    assert_eq!(pages[0].findings[0].category, "email");
    assert_eq!(pages[0].findings[0].text, "taro@example.com");
    assert!(pages[1].findings.is_empty());
}

#[test]
fn ignored_terms_are_dropped_regardless_of_ocr_spacing() {
    let tmp = tempfile::tempdir().unwrap();
    // 生成部 (a "generation section") is flagged as a department by heuristic
    // but is not an organizational unit; the project ignores it.
    let project_dir = project_with_ocr(&tmp, &["信号は生 成 部で処理する"]);
    save_project_settings(
        &project_dir,
        &ProjectSettings {
            ignored: vec!["生成部".into()],
            ..Default::default()
        },
    )
    .unwrap();

    detect_pages(&project_dir, &builtin_rules()).unwrap();

    let pages = load_findings(&project_dir).unwrap();
    assert!(
        !pages[0]
            .findings
            .iter()
            .any(|finding| finding.text.replace(' ', "") == "生成部"),
        "ignored term leaked: {:?}",
        pages[0].findings
    );
}

#[test]
fn a_category_scoped_ignore_only_drops_that_category() {
    let tmp = tempfile::tempdir().unwrap();
    // "技術開発部" is a real department; "技術開発部" as an organization would
    // be wrong. Scope the ignore to organization only.
    let project_dir = project_with_ocr(&tmp, &["技術開発部の会議"]);
    save_project_settings(
        &project_dir,
        &ProjectSettings {
            ignored: vec![IgnoreEntry::Scoped {
                text: "技術開発部".to_string(),
                category: "organization".to_string(),
            }],
            ..Default::default()
        },
    )
    .unwrap();

    detect_pages(&project_dir, &builtin_rules()).unwrap();

    let findings = &load_findings(&project_dir).unwrap()[0].findings;
    // The department finding survives; only an organization one would be cut.
    assert!(
        findings
            .iter()
            .any(|f| f.category == "department" && f.text == "技術開発部"),
        "department finding wrongly dropped: {findings:?}"
    );
}
