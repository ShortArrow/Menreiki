use std::fs;

use menreiki_project::{
    clear_analysis, import, page_findings_path, page_image_path, page_ocr_path,
    page_render_path, plan_path, sanitized_pdf_path, MANIFEST_FILE_NAME, SOURCE_DIR,
};

#[test]
fn clear_analysis_removes_derived_artifacts_but_keeps_the_source() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("spec.menreiki");
    import(&input, &project_dir).unwrap();
    for path in [
        page_image_path(&project_dir, 0),
        page_ocr_path(&project_dir, 0),
        page_findings_path(&project_dir, 0),
        page_render_path(&project_dir, 0),
        sanitized_pdf_path(&project_dir),
        plan_path(&project_dir),
    ] {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"stale").unwrap();
    }

    clear_analysis(&project_dir).unwrap();

    assert!(!page_image_path(&project_dir, 0).exists());
    assert!(!page_ocr_path(&project_dir, 0).exists());
    assert!(!page_findings_path(&project_dir, 0).exists());
    assert!(!page_render_path(&project_dir, 0).exists());
    assert!(!sanitized_pdf_path(&project_dir).exists());
    assert!(!plan_path(&project_dir).exists());
    assert!(project_dir.join(MANIFEST_FILE_NAME).exists());
    assert!(project_dir.join(SOURCE_DIR).join("spec.pdf").exists());
}

#[test]
fn clear_analysis_on_a_fresh_project_is_a_no_op() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("spec.menreiki");
    import(&input, &project_dir).unwrap();

    clear_analysis(&project_dir).unwrap();

    assert!(project_dir.join(MANIFEST_FILE_NAME).exists());
}
