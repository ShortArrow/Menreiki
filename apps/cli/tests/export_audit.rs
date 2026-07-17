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

fn menreiki() -> assert_cmd::Command {
    let mut command = assert_cmd::Command::cargo_bin("menreiki").unwrap();
    command.env("MENREIKI_PDFIUM_PATH", pdfium_dir());
    command
}

fn analyzed_project(tmp: &tempfile::TempDir) -> PathBuf {
    let input = tmp.path().join("spec.pdf");
    fs::write(
        &input,
        minimal_pdf_with_text(&["Contact: taro@example.com"]),
    )
    .unwrap();
    let project_dir = tmp.path().join("spec.menreiki");
    menreiki()
        .arg("import")
        .arg(&input)
        .arg("--project")
        .arg(&project_dir)
        .assert()
        .success();
    menreiki()
        .arg("analyze")
        .arg(&project_dir)
        .assert()
        .success();
    project_dir
}

#[test]
fn masked_document_exports_and_passes_audit() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = analyzed_project(&tmp);
    let policy_path = tmp.path().join("policy.yaml");
    fs::write(
        &policy_path,
        "rules:\n  - match: { category: email }\n    action: { type: mask }\n",
    )
    .unwrap();

    menreiki()
        .arg("apply")
        .arg(&project_dir)
        .arg("--policy")
        .arg(&policy_path)
        .assert()
        .success();
    menreiki()
        .arg("export")
        .arg(&project_dir)
        .assert()
        .success();
    menreiki()
        .arg("audit")
        .arg(&project_dir)
        .arg("--policy")
        .arg(&policy_path)
        .assert()
        .success()
        .stdout(predicates::str::contains("Pass"));

    let pdf = fs::read(project_dir.join("output").join("sanitized.pdf")).unwrap();
    assert!(pdf.starts_with(b"%PDF-1.4"));
    let pdf_text = String::from_utf8_lossy(&pdf);
    assert!(!pdf_text.contains("taro@example.com"));
}

#[test]
fn untouched_document_fails_audit_against_a_wordlist() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = analyzed_project(&tmp);
    let keep_policy = tmp.path().join("keep.yaml");
    fs::write(
        &keep_policy,
        "rules:\n  - match: { category: email }\n    action: { type: keep }\n",
    )
    .unwrap();
    let wordlist = tmp.path().join("deny.txt");
    fs::write(&wordlist, "taro@example.com\n").unwrap();

    menreiki()
        .arg("apply")
        .arg(&project_dir)
        .arg("--policy")
        .arg(&keep_policy)
        .assert()
        .success();
    menreiki()
        .arg("audit")
        .arg(&project_dir)
        .arg("--deny-wordlist")
        .arg(&wordlist)
        .assert()
        .failure()
        .stdout(predicates::str::contains("residual"));
}
