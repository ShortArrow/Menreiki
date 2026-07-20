use std::fs;
use std::path::Path;

use menreiki_detect::RegexRule;
use menreiki_lang_ja::dictionary_rule;
use serde::{Deserialize, Serialize};

use crate::layout::{dictionary_path, RULES_DIR};

/// One user-registered term that must be flagged on every analysis —
/// how names without a mechanical pattern (organizations, people,
/// products) become automatically detectable.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DictionaryEntry {
    pub category: String,
    pub text: String,
}

#[derive(Debug, thiserror::Error)]
pub enum DictionaryError {
    #[error("dictionary could not be read: {0}")]
    Read(std::io::Error),
    #[error("dictionary is not valid: {0}")]
    Parse(#[from] serde_json::Error),
    #[error("dictionary could not be written: {0}")]
    Write(std::io::Error),
}

/// Reads the project dictionary; a project without one has no entries.
pub fn load_dictionary(project_dir: &Path) -> Result<Vec<DictionaryEntry>, DictionaryError> {
    let path = dictionary_path(project_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(path).map_err(DictionaryError::Read)?;
    Ok(serde_json::from_str(&text)?)
}

/// Adds a term (replacing an existing entry with the same text) and
/// returns the updated dictionary.
pub fn add_dictionary_entry(
    project_dir: &Path,
    entry: DictionaryEntry,
) -> Result<Vec<DictionaryEntry>, DictionaryError> {
    let mut entries = load_dictionary(project_dir)?;
    entries.retain(|existing| existing.text != entry.text);
    entries.push(entry);
    save_dictionary(project_dir, &entries)?;
    Ok(entries)
}

/// Removes the entry with the given text and returns the updated dictionary.
pub fn remove_dictionary_entry(
    project_dir: &Path,
    text: &str,
) -> Result<Vec<DictionaryEntry>, DictionaryError> {
    let mut entries = load_dictionary(project_dir)?;
    entries.retain(|existing| existing.text != text);
    save_dictionary(project_dir, &entries)?;
    Ok(entries)
}

/// Detection rules for every dictionary entry, OCR-tolerant like search.
pub fn dictionary_rules(entries: &[DictionaryEntry]) -> Vec<RegexRule> {
    entries
        .iter()
        .filter(|entry| !entry.text.trim().is_empty())
        .map(|entry| dictionary_rule(&entry.category, &entry.text))
        .collect()
}

fn save_dictionary(
    project_dir: &Path,
    entries: &[DictionaryEntry],
) -> Result<(), DictionaryError> {
    fs::create_dir_all(project_dir.join(RULES_DIR)).map_err(DictionaryError::Write)?;
    let text =
        serde_json::to_string_pretty(entries).expect("dictionary is always serializable");
    fs::write(dictionary_path(project_dir), text).map_err(DictionaryError::Write)
}
