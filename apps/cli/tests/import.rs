use std::fs;

#[test]
fn import_command_creates_project_directory() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("out.menreiki");

    assert_cmd::Command::cargo_bin("menreiki")
        .unwrap()
        .arg("import")
        .arg(&input)
        .arg("--project")
        .arg(&project_dir)
        .assert()
        .success();

    assert!(project_dir.join("project.json").exists());
    assert!(project_dir.join("source").join("spec.pdf").exists());
}

#[test]
fn import_command_defaults_project_dir_beside_input() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();

    assert_cmd::Command::cargo_bin("menreiki")
        .unwrap()
        .arg("import")
        .arg(&input)
        .assert()
        .success();

    assert!(tmp.path().join("spec.menreiki").join("project.json").exists());
}

#[test]
fn import_command_fails_on_missing_input() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("missing.pdf");

    assert_cmd::Command::cargo_bin("menreiki")
        .unwrap()
        .arg("import")
        .arg(&input)
        .assert()
        .failure();
}
