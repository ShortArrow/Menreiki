use std::fs;
use std::path::Path;

use menreiki_entity::Entity;

use crate::layout::{entities_path, ENTITIES_DIR};

#[derive(Debug, thiserror::Error)]
pub enum EntitiesError {
    #[error("entities could not be read: {0}")]
    Read(std::io::Error),
    #[error("entities are not valid: {0}")]
    Parse(#[from] serde_json::Error),
    #[error("entities could not be written: {0}")]
    Write(std::io::Error),
}

/// Reads the entity register; a project without one has no entities.
pub fn load_entities(project_dir: &Path) -> Result<Vec<Entity>, EntitiesError> {
    let path = entities_path(project_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(path).map_err(EntitiesError::Read)?;
    Ok(serde_json::from_str(&text)?)
}

pub fn save_entities(project_dir: &Path, entities: &[Entity]) -> Result<(), EntitiesError> {
    fs::create_dir_all(project_dir.join(ENTITIES_DIR)).map_err(EntitiesError::Write)?;
    let text =
        serde_json::to_string_pretty(entities).expect("entities are always serializable");
    fs::write(entities_path(project_dir), text).map_err(EntitiesError::Write)
}
