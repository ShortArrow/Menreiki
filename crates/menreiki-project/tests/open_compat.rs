use std::fs;

use menreiki_project::{
    import, load_manifest, resolve_project_dir, LEGACY_MANIFEST_FILE_NAME, MANIFEST_FILE_NAME,
};

#[test]
fn import_writes_the_mnrk_manifest() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("spec.menreiki");

    import(&input, &project_dir).unwrap();

    assert!(project_dir.join(MANIFEST_FILE_NAME).exists());
    assert_eq!(MANIFEST_FILE_NAME, "project.mnrk");
}

#[test]
fn legacy_project_json_still_loads() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("spec.menreiki");
    import(&input, &project_dir).unwrap();
    fs::rename(
        project_dir.join(MANIFEST_FILE_NAME),
        project_dir.join(LEGACY_MANIFEST_FILE_NAME),
    )
    .unwrap();

    let manifest = load_manifest(&project_dir).unwrap();

    assert_eq!(manifest.source().file_name(), "spec.pdf");
}

#[test]
fn resolve_accepts_the_directory_or_the_manifest_file() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("spec.menreiki");
    import(&input, &project_dir).unwrap();

    assert_eq!(resolve_project_dir(&project_dir), project_dir);
    assert_eq!(
        resolve_project_dir(&project_dir.join(MANIFEST_FILE_NAME)),
        project_dir
    );
}
