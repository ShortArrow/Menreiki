//! User-level settings, stored under `~/.config/menreiki/`:
//! `config.toml` for preferences (theme) and `session.json` for
//! transient UI state (window placement).

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// `~/.config/menreiki`, overridable with `MENREIKI_CONFIG_DIR`.
pub fn config_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("MENREIKI_CONFIG_DIR") {
        return Some(PathBuf::from(dir));
    }
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(PathBuf::from(home).join(".config").join("menreiki"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    Light,
    Dark,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub theme: Theme,
    #[serde(default)]
    pub inference: InferenceConfig,
    #[serde(default)]
    pub detection: DetectionConfig,
}

/// Detector groups the user has turned off (by id, e.g. "phone-jp").
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct DetectionConfig {
    #[serde(default)]
    pub disabled: Vec<String>,
}

/// Where the optional local model lives. `model` empty means the LLM
/// features are unconfigured and stay off.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InferenceConfig {
    #[serde(default = "default_inference_url")]
    pub base_url: String,
    #[serde(default)]
    pub model: String,
}

fn default_inference_url() -> String {
    "http://localhost:11434/v1".to_string()
}

impl Default for InferenceConfig {
    fn default() -> Self {
        Self {
            base_url: default_inference_url(),
            model: String::new(),
        }
    }
}

pub fn load_config() -> Config {
    config_dir()
        .map(|dir| dir.join("config.toml"))
        .and_then(|path| fs::read_to_string(path).ok())
        .map(|text| parse_config(&text))
        .unwrap_or_default()
}

/// Parses `config.toml`; unknown or missing fields fall back to defaults so
/// an old or hand-edited file never locks the user out.
pub fn parse_config(text: &str) -> Config {
    toml::from_str(text).unwrap_or_default()
}

pub fn save_config(config: &Config) -> Result<(), String> {
    let dir = config_dir().ok_or("home directory not found")?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let text = toml::to_string_pretty(config).map_err(|error| error.to_string())?;
    fs::write(dir.join("config.toml"), text).map_err(|error| error.to_string())
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub maximized: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub window: Option<WindowState>,
}

pub fn load_session() -> Session {
    config_dir()
        .map(|dir| dir.join("session.json"))
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save_session(session: &Session) -> Result<(), String> {
    let dir = config_dir().ok_or("home directory not found")?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let text = serde_json::to_string_pretty(session).expect("session is always serializable");
    fs::write(dir.join("session.json"), text).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_config_falls_back_to_light_theme() {
        assert_eq!(parse_config("").theme, Theme::Light);
    }

    #[test]
    fn dark_theme_round_trips_through_toml() {
        let config = parse_config("theme = \"dark\"\n");

        assert_eq!(config.theme, Theme::Dark);
        let text = toml::to_string_pretty(&config).unwrap();
        assert_eq!(parse_config(&text), config);
    }

    #[test]
    fn broken_config_never_locks_the_user_out() {
        assert_eq!(parse_config("theme = 12345").theme, Theme::Light);
    }

    #[test]
    fn inference_settings_round_trip_and_default_sanely() {
        let config = parse_config("");
        assert_eq!(config.inference.base_url, "http://localhost:11434/v1");
        assert_eq!(config.inference.model, "");

        let config =
            parse_config("[inference]\nbase_url = \"http://localhost:1234/v1\"\nmodel = \"qwen\"\n");
        assert_eq!(config.inference.base_url, "http://localhost:1234/v1");
        assert_eq!(config.inference.model, "qwen");
        let text = toml::to_string_pretty(&config).unwrap();
        assert_eq!(parse_config(&text), config);
    }

    #[test]
    fn session_round_trips_through_json() {
        let session = Session {
            window: Some(WindowState {
                x: -8,
                y: 120,
                width: 1400,
                height: 900,
                maximized: false,
            }),
        };

        let text = serde_json::to_string(&session).unwrap();

        assert_eq!(serde_json::from_str::<Session>(&text).unwrap(), session);
    }
}
