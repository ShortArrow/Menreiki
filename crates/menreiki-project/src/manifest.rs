use std::fs;
use std::path::Path;

use menreiki_core::SourceDocument;
use serde::{Deserialize, Serialize};

use crate::layout::{LEGACY_MANIFEST_FILE_NAME, MANIFEST_FILE_NAME};

pub const SCHEMA_VERSION: u32 = 1;

/// Identity of a project, persisted as `project.mnrk` in the project root.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectManifest {
    schema_version: u32,
    source: SourceDocument,
}

impl ProjectManifest {
    pub(crate) fn new(source: SourceDocument) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            source,
        }
    }

    pub fn source(&self) -> &SourceDocument {
        &self.source
    }
}

#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    #[error("project manifest could not be read: {0}")]
    Read(std::io::Error),
    #[error("project manifest is not valid: {0}")]
    Parse(#[from] serde_json::Error),
}

/// Reads the manifest back from an existing project directory, accepting
/// the legacy `project.json` name from projects created by older builds.
pub fn load_manifest(project_dir: &Path) -> Result<ProjectManifest, LoadError> {
    let path = project_dir.join(MANIFEST_FILE_NAME);
    let path = if path.exists() {
        path
    } else {
        project_dir.join(LEGACY_MANIFEST_FILE_NAME)
    };
    let text = fs::read_to_string(path).map_err(LoadError::Read)?;
    Ok(serde_json::from_str(&text)?)
}
