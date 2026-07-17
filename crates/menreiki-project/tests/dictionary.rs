use std::fs;

use menreiki_core::{OcrLine, PageOcr, Rect, Span};
use menreiki_project::{
    add_dictionary_entry, detect_pages, dictionary_rules, import, load_dictionary,
    load_findings, page_ocr_path, remove_dictionary_entry, DictionaryEntry, OCR_DIR,
};

fn entry(category: &str, text: &str) -> DictionaryEntry {
    DictionaryEntry {
        category: category.to_string(),
        text: text.to_string(),
    }
}

fn fresh_project(tmp: &tempfile::TempDir) -> std::path::PathBuf {
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("spec.menreiki");
    import(&input, &project_dir).unwrap();
    project_dir
}

#[test]
fn dictionary_add_remove_round_trip() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = fresh_project(&tmp);

    assert!(load_dictionary(&project_dir).unwrap().is_empty());

    add_dictionary_entry(&project_dir, entry("organization", "ベータ電子")).unwrap();
    let entries =
        add_dictionary_entry(&project_dir, entry("product", "ZX-140")).unwrap();
    assert_eq!(entries.len(), 2);

    let entries = remove_dictionary_entry(&project_dir, "ベータ電子").unwrap();
    assert_eq!(entries, vec![entry("product", "ZX-140")]);
    assert_eq!(load_dictionary(&project_dir).unwrap(), entries);
}

#[test]
fn dictionary_terms_become_findings_on_analysis() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = fresh_project(&tmp);
    add_dictionary_entry(&project_dir, entry("organization", "ベータ電子")).unwrap();

    fs::create_dir_all(project_dir.join(OCR_DIR)).unwrap();
    let page = PageOcr {
        width: 1000,
        height: 100,
        lines: vec![OcrLine {
            text: "納入元はベータ電子とする".to_string(),
            words: vec![Span {
                text: "納入元はベータ電子とする".to_string(),
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

    let rules = dictionary_rules(&load_dictionary(&project_dir).unwrap());
    detect_pages(&project_dir, &rules).unwrap();

    let findings = load_findings(&project_dir).unwrap();
    let hit = findings[0]
        .findings
        .iter()
        .find(|finding| finding.detector == "dictionary")
        .expect("dictionary term should be detected");
    assert_eq!(hit.category, "organization");
    assert_eq!(hit.text, "ベータ電子");
}
