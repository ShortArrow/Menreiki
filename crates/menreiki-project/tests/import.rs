use std::fs;
use std::path::{Path, PathBuf};

use menreiki_project::{
    import, inspect_existing_project, ExistingProject, ImportError, MANIFEST_FILE_NAME,
};

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

/// Imports `spec.pdf` into `spec.menreiki/` and returns `(tmp, input, project_dir)`.
fn imported_spec() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("spec.menreiki");
    import(&input, &project_dir).unwrap();
    (tmp, input, project_dir)
}

/// Every file under `dir`, relative and sorted, with its bytes.
fn snapshot(dir: &Path) -> Vec<(PathBuf, Vec<u8>)> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<(PathBuf, Vec<u8>)>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(root, &path, out);
            } else {
                let rel = path.strip_prefix(root).unwrap().to_path_buf();
                out.push((rel, fs::read(&path).unwrap()));
            }
        }
    }
    let mut out = Vec::new();
    walk(dir, dir, &mut out);
    out.sort();
    out
}

const UNKNOWN: ExistingProject = ExistingProject {
    same_source: None,
    existing_file_name: None,
};

#[test]
fn inspect_recognizes_the_same_source() {
    let (_tmp, input, project_dir) = imported_spec();

    let existing = inspect_existing_project(&input, &project_dir);

    assert_eq!(existing.same_source, Some(true));
    assert_eq!(existing.existing_file_name.as_deref(), Some("spec.pdf"));
}

#[test]
fn inspect_rejects_a_different_file_with_the_same_stem() {
    let (tmp, _input, project_dir) = imported_spec();
    let other = tmp.path().join("spec.png");
    fs::write(&other, b"\x89PNG different body").unwrap();

    let existing = inspect_existing_project(&other, &project_dir);

    assert_eq!(existing.same_source, Some(false));
    assert_eq!(existing.existing_file_name.as_deref(), Some("spec.pdf"));
}

#[test]
fn inspect_rejects_a_replaced_revision_under_the_same_name() {
    let (_tmp, input, project_dir) = imported_spec();
    fs::write(&input, b"%PDF-1.7 second edition").unwrap();

    let existing = inspect_existing_project(&input, &project_dir);

    assert_eq!(existing.same_source, Some(false));
    assert_eq!(existing.existing_file_name.as_deref(), Some("spec.pdf"));
}

#[test]
fn inspect_reports_unknown_for_an_empty_folder() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("spec.menreiki");
    fs::create_dir(&project_dir).unwrap();

    assert_eq!(inspect_existing_project(&input, &project_dir), UNKNOWN);
}

#[test]
fn inspect_reports_unknown_for_a_broken_manifest() {
    let (_tmp, input, project_dir) = imported_spec();
    fs::write(project_dir.join(MANIFEST_FILE_NAME), b"not json at all").unwrap();

    assert_eq!(inspect_existing_project(&input, &project_dir), UNKNOWN);
}

#[test]
fn inspect_reports_unknown_when_the_project_path_is_a_file() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("spec.menreiki");
    fs::write(&project_dir, b"just a file").unwrap();

    assert_eq!(inspect_existing_project(&input, &project_dir), UNKNOWN);
}

#[test]
fn inspect_reports_unknown_sameness_when_the_input_is_unreadable() {
    let (_tmp, input, project_dir) = imported_spec();
    fs::remove_file(&input).unwrap();

    let existing = inspect_existing_project(&input, &project_dir);

    assert_eq!(existing.same_source, None);
    assert_eq!(existing.existing_file_name.as_deref(), Some("spec.pdf"));
}

#[test]
fn inspect_and_refused_import_leave_the_existing_project_untouched() {
    let (tmp, input, project_dir) = imported_spec();
    let other = tmp.path().join("spec.png");
    fs::write(&other, b"\x89PNG different body").unwrap();
    let manifest_before = fs::read(project_dir.join(MANIFEST_FILE_NAME)).unwrap();
    let before = snapshot(&project_dir);

    for candidate in [&input, &other] {
        inspect_existing_project(candidate, &project_dir);
        let result = import(candidate, &project_dir);
        assert!(matches!(result, Err(ImportError::ProjectDirExists(_))));
    }

    assert_eq!(
        fs::read(project_dir.join(MANIFEST_FILE_NAME)).unwrap(),
        manifest_before
    );
    assert_eq!(snapshot(&project_dir), before);
}
