use std::fs;
use std::path::Path;

use menreiki_core::SourceDocument;
use serde::{Deserialize, Serialize};

use crate::layout::{LEGACY_MANIFEST_FILE_NAME, MANIFEST_FILE_NAME};

pub const SCHEMA_VERSION: u32 = 1;

/// Project-scoped settings, persisted inside `project.mnrk`. These describe
/// one document and travel with it — as opposed to app-level preferences
/// (config.toml) and transient UI state (session.json).
/// A text that should never become a finding in this project — the escape
/// hatch for heuristic false positives. Two forms:
/// - a bare string ignores that text under every category;
/// - `{ text, category }` ignores it only when found as that category, so a
///   surname wrongly flagged as a department can be dropped there while the
///   person finding for the same text stays.
///
/// Text is compared ignoring whitespace, so OCR spacing does not matter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum IgnoreEntry {
    Text(String),
    Scoped { text: String, category: String },
}

impl IgnoreEntry {
    pub fn text(&self) -> &str {
        match self {
            IgnoreEntry::Text(text) | IgnoreEntry::Scoped { text, .. } => text,
        }
    }

    /// Whether this entry suppresses a finding of `category` with `text`.
    pub fn matches(&self, text: &str, category: &str) -> bool {
        let same_text = strip_ws(self.text()) == strip_ws(text);
        match self {
            IgnoreEntry::Text(_) => same_text,
            IgnoreEntry::Scoped { category: scope, .. } => same_text && scope == category,
        }
    }
}

impl From<&str> for IgnoreEntry {
    fn from(text: &str) -> Self {
        IgnoreEntry::Text(text.to_string())
    }
}

fn strip_ws(text: &str) -> String {
    text.chars().filter(|c| !c.is_whitespace()).collect()
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectSettings {
    /// Detector group ids this project uses. `None` means all default
    /// detectors (so a detector added to a pack later still runs on this
    /// project); `Some` is an allow-list of exactly the groups it needs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detectors: Option<Vec<String>>,
    /// Findings this project suppresses (see [`IgnoreEntry`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ignored: Vec<IgnoreEntry>,
}

/// Identity and settings of a project, persisted as `project.mnrk` in the
/// project root.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectManifest {
    schema_version: u32,
    source: SourceDocument,
    #[serde(default)]
    settings: ProjectSettings,
}

impl ProjectManifest {
    pub(crate) fn new(source: SourceDocument) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            source,
            settings: ProjectSettings::default(),
        }
    }

    pub fn source(&self) -> &SourceDocument {
        &self.source
    }

    pub fn settings(&self) -> &ProjectSettings {
        &self.settings
    }
}

#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    #[error("project manifest could not be read: {0}")]
    Read(std::io::Error),
    #[error("project manifest is not valid: {0}")]
    Parse(#[from] serde_json::Error),
}

#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error(transparent)]
    Load(#[from] LoadError),
    #[error("project manifest could not be written: {0}")]
    Write(std::io::Error),
}

/// Reads the project-scoped settings from `project.mnrk`.
pub fn load_project_settings(project_dir: &Path) -> Result<ProjectSettings, LoadError> {
    Ok(load_manifest(project_dir)?.settings)
}

/// Writes the project-scoped settings back into `project.mnrk`, preserving
/// identity. Always writes the canonical `project.mnrk` name even if the
/// project still had a legacy `project.json`.
pub fn save_project_settings(
    project_dir: &Path,
    settings: &ProjectSettings,
) -> Result<(), SettingsError> {
    let mut manifest = load_manifest(project_dir)?;
    manifest.settings = settings.clone();
    let json = serde_json::to_string_pretty(&manifest).expect("manifest is always serializable");
    fs::write(project_dir.join(MANIFEST_FILE_NAME), json).map_err(SettingsError::Write)
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
