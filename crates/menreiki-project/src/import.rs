use std::fs;
use std::path::Path;

use menreiki_core::SourceDocument;

use crate::layout::{MANIFEST_FILE_NAME, SOURCE_DIR};
use crate::manifest::ProjectManifest;

#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("input file could not be read: {0}")]
    Input(std::io::Error),
    #[error("input path has no file name")]
    MissingFileName,
    #[error("project directory already exists: {0}")]
    ProjectDirExists(std::path::PathBuf),
    #[error("project could not be written: {0}")]
    Project(std::io::Error),
}

/// Creates a new project directory from an input document.
///
/// Copies the original into `source/` under its own file name and writes
/// `project.mnrk`. Refuses to touch a `project_dir` that already exists so
/// an existing project can never be silently overwritten.
pub fn import(input: &Path, project_dir: &Path) -> Result<ProjectManifest, ImportError> {
    let bytes = fs::read(input).map_err(ImportError::Input)?;
    let file_name = input
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(ImportError::MissingFileName)?;

    if project_dir.exists() {
        return Err(ImportError::ProjectDirExists(project_dir.to_path_buf()));
    }

    let manifest = ProjectManifest::new(SourceDocument::from_bytes(file_name, &bytes));

    let source_dir = project_dir.join(SOURCE_DIR);
    fs::create_dir_all(&source_dir).map_err(ImportError::Project)?;
    fs::write(source_dir.join(file_name), &bytes).map_err(ImportError::Project)?;

    let manifest_json =
        serde_json::to_string_pretty(&manifest).expect("manifest is always serializable");
    fs::write(project_dir.join(MANIFEST_FILE_NAME), manifest_json).map_err(ImportError::Project)?;

    Ok(manifest)
}
