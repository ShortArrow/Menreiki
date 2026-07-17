use std::fs;
use std::path::{Path, PathBuf};

use menreiki_test_support::minimal_pdf_with_text;

fn pdfium_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("vendor")
        .join("pdfium")
}

#[test]
fn full_pipeline_detects_email_in_rendered_document() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("spec.pdf");
    fs::write(
        &input,
        minimal_pdf_with_text(&["Contact: taro@example.com"]),
    )
    .unwrap();
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

    assert_cmd::Command::cargo_bin("menreiki")
        .unwrap()
        .arg("findings")
        .arg(&project_dir)
        .assert()
        .success()
        .stdout(predicates::str::contains("[email]"))
        .stdout(predicates::str::contains("taro@example.com"));
}
