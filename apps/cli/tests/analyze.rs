use std::fs;
use std::path::{Path, PathBuf};

use menreiki_test_support::minimal_pdf;

fn pdfium_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("vendor")
        .join("pdfium")
}

#[test]
fn analyze_renders_pages_into_project() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, minimal_pdf(2)).unwrap();
    let project_dir = tmp.path().join("spec.menreiki");

    assert_cmd::Command::cargo_bin("menreiki")
        .unwrap()
        .arg("import")
        .arg(&input)
        .arg("--project")
        .arg(&project_dir)
        .assert()
        .success();

    assert_cmd::Command::cargo_bin("menreiki")
        .unwrap()
        .env("MENREIKI_PDFIUM_PATH", pdfium_dir())
        .arg("analyze")
        .arg(&project_dir)
        .assert()
        .success();

    assert!(project_dir.join("pages").join("page-001.png").exists());
    assert!(project_dir.join("pages").join("page-002.png").exists());
    assert!(project_dir.join("ocr").join("page-001.json").exists());
    assert!(project_dir.join("ocr").join("page-002.json").exists());
}

#[test]
fn analyze_fails_on_missing_project() {
    let tmp = tempfile::tempdir().unwrap();

    assert_cmd::Command::cargo_bin("menreiki")
        .unwrap()
        .env("MENREIKI_PDFIUM_PATH", pdfium_dir())
        .arg("analyze")
        .arg(tmp.path().join("nonexistent.menreiki"))
        .assert()
        .failure();
}
