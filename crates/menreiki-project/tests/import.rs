use std::fs;

use menreiki_project::{import, ImportError, MANIFEST_FILE_NAME};

#[test]
fn import_copies_source_and_writes_manifest() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("spec.menreiki");

    let manifest = import(&input, &project_dir).unwrap();

    assert_eq!(manifest.source().file_name(), "spec.pdf");
    assert!(project_dir.join("source").join("spec.pdf").exists());

    let manifest_json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(project_dir.join(MANIFEST_FILE_NAME)).unwrap())
            .unwrap();
    assert_eq!(manifest_json["schema_version"], 1);
    assert_eq!(
        manifest_json["source"]["sha256"],
        manifest.source().sha256_hex()
    );
}

#[test]
fn import_refuses_existing_project_dir() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("occupied.menreiki");
    fs::create_dir(&project_dir).unwrap();

    let result = import(&input, &project_dir);

    assert!(matches!(result, Err(ImportError::ProjectDirExists(_))));
}

#[test]
fn import_reports_missing_input() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("missing.pdf");
    let project_dir = tmp.path().join("missing.menreiki");

    let result = import(&input, &project_dir);

    assert!(matches!(result, Err(ImportError::Input(_))));
    assert!(!project_dir.exists());
}
