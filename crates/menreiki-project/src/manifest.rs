use std::fs;
use std::path::Path;

use menreiki_core::SourceDocument;
use serde::{Deserialize, Serialize};

use crate::layout::MANIFEST_FILE_NAME;

pub const SCHEMA_VERSION: u32 = 1;

/// Identity of a project, persisted as `project.json` in the project root.
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
    #[error("project.json could not be read: {0}")]
    Read(std::io::Error),
    #[error("project.json is not valid: {0}")]
    Parse(#[from] serde_json::Error),
}

/// Reads `project.json` back from an existing project directory.
pub fn load_manifest(project_dir: &Path) -> Result<ProjectManifest, LoadError> {
    let text = fs::read_to_string(project_dir.join(MANIFEST_FILE_NAME)).map_err(LoadError::Read)?;
    Ok(serde_json::from_str(&text)?)
}
