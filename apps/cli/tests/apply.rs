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

fn analyzed_project(tmp: &tempfile::TempDir) -> PathBuf {
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
    project_dir
}

#[test]
fn apply_command_renders_transformed_pages() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = analyzed_project(&tmp);
    let policy_path = tmp.path().join("policy.yaml");
    fs::write(
        &policy_path,
        "rules:\n  - match: { category: email }\n    action: { type: mask }\n",
    )
    .unwrap();

    assert_cmd::Command::cargo_bin("menreiki")
        .unwrap()
        .arg("apply")
        .arg(&project_dir)
        .arg("--policy")
        .arg(&policy_path)
        .assert()
        .success();

    assert!(project_dir.join("renders").join("page-001.png").exists());
    assert!(project_dir.join("decisions").join("plan.json").exists());
}

#[test]
fn search_command_lists_occurrences() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = analyzed_project(&tmp);

    assert_cmd::Command::cargo_bin("menreiki")
        .unwrap()
        .arg("search")
        .arg(&project_dir)
        .arg("taro@example.com")
        .assert()
        .success()
        .stdout(predicates::str::contains("page   1"))
        .stdout(predicates::str::contains("1 matches"));
}
