use std::fs;
use std::path::{Path, PathBuf};

fn pdfium_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("vendor")
        .join("pdfium")
}

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("test-documents")
        .join(name)
}

#[test]
fn a_single_image_goes_through_the_whole_analysis() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("scan.png");
    fs::copy(fixture("dummy-page.png"), &input)
        .expect("fixture missing; run scripts/make-test-documents.ps1 first");
    let project_dir = tmp.path().join("scan.menreiki");

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
    assert!(!project_dir.join("pages").join("page-002.png").exists());

    assert_cmd::Command::cargo_bin("menreiki")
        .unwrap()
        .arg("findings")
        .arg(&project_dir)
        .assert()
        .success()
        .stdout(predicates::str::contains("[email]"));
}
