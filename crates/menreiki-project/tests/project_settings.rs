use std::fs;

use menreiki_project::{
    import, load_project_settings, save_project_settings, ProjectSettings, MANIFEST_FILE_NAME,
};

fn fresh_project(tmp: &tempfile::TempDir) -> std::path::PathBuf {
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("spec.menreiki");
    import(&input, &project_dir).unwrap();
    project_dir
}

#[test]
fn a_fresh_project_selects_all_detectors() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = fresh_project(&tmp);

    assert_eq!(load_project_settings(&project_dir).unwrap().detectors, None);
}

#[test]
fn detector_selection_round_trips_and_keeps_the_source() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = fresh_project(&tmp);

    save_project_settings(
        &project_dir,
        &ProjectSettings {
            detectors: Some(vec!["email".to_string(), "phone-jp".to_string()]),
            ..Default::default()
        },
    )
    .unwrap();

    let settings = load_project_settings(&project_dir).unwrap();
    assert_eq!(
        settings.detectors,
        Some(vec!["email".to_string(), "phone-jp".to_string()])
    );

    // The source identity in the same .mnrk survives the settings write.
    let manifest: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(project_dir.join(MANIFEST_FILE_NAME)).unwrap())
            .unwrap();
    assert_eq!(manifest["source"]["file_name"], "spec.pdf");
    assert_eq!(manifest["schema_version"], 1);
}

#[test]
fn clearing_the_selection_returns_to_all() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = fresh_project(&tmp);
    save_project_settings(
        &project_dir,
        &ProjectSettings {
            detectors: Some(vec!["email".to_string()]),
            ..Default::default()
        },
    )
    .unwrap();

    save_project_settings(&project_dir, &ProjectSettings::default()).unwrap();

    assert_eq!(load_project_settings(&project_dir).unwrap().detectors, None);
}
