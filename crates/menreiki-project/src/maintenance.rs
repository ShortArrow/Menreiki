use std::fs;
use std::path::Path;

use crate::layout::{
    plan_path, AUDIT_DIR, FINDINGS_DIR, OCR_DIR, OUTPUT_DIR, PAGES_DIR, RENDERS_DIR,
};

/// Removes every artifact derived from a previous analysis — page images,
/// OCR results, findings, transformed pages, exported output, audit
/// reports, and the persisted edit plan — so a re-run starts from a clean
/// slate. Analysis is not guaranteed to be idempotent (engines and models
/// change, and a crash can leave partial results), so stale artifacts must
/// never survive into the next run. The source snapshot and `project.mnrk`
/// stay untouched.
pub fn clear_analysis(project_dir: &Path) -> std::io::Result<()> {
    for dir in [
        PAGES_DIR,
        OCR_DIR,
        FINDINGS_DIR,
        RENDERS_DIR,
        OUTPUT_DIR,
        AUDIT_DIR,
    ] {
        let path = project_dir.join(dir);
        if path.exists() {
            fs::remove_dir_all(&path)?;
        }
    }
    let plan = plan_path(project_dir);
    if plan.exists() {
        fs::remove_file(plan)?;
    }
    Ok(())
}
