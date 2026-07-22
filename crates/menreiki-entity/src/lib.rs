//! Entity management: one logical subject (a company, a person, a product)
//! with all its spellings, replaced document-wide by one consistent alias.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Entity {
    pub id: String,
    /// Information category, e.g. "organization", "person".
    pub category: String,
    /// The consistent replacement every variant maps to.
    pub alias: String,
    /// All spellings of this entity; the first is the representative.
    pub variants: Vec<String>,
    /// Horizontal placement of the alias when it replaces a variant
    /// ("left" / "center" / "right"); `None` means centered.
    #[serde(default)]
    pub align: Option<String>,
}

/// Canonical form for comparing spellings: whitespace dropped, hiragana
/// folded to katakana (OCR confuses the two), and company legal forms
/// removed so 株式会社アルファ技研 and アルファ技研 compare equal.
pub fn normalize_name(text: &str) -> String {
    let mut folded: String = text
        .chars()
        .filter(|character| !character.is_whitespace())
        .map(|character| {
            let code = character as u32;
            if (0x3041..=0x3096).contains(&code) {
                char::from_u32(code + 0x60).unwrap_or(character)
            } else {
                character
            }
        })
        .collect();
    for form in ["株式会社", "有限会社", "合同会社", "（株）", "(株)"] {
        folded = folded.replace(form, "");
    }
    folded
}

/// Spellings from `candidates` that plausibly belong to `entity` and are
/// not registered yet — same normalized form, containment, or a shared
/// stem of at least three characters. Deliberately generous: suggestions
/// are confirmed by a human before they join the entity.
pub fn suggest_variants<'a>(
    entity: &Entity,
    candidates: impl IntoIterator<Item = &'a str>,
) -> Vec<String> {
    let known: Vec<String> = entity.variants.iter().map(|v| normalize_name(v)).collect();
    let mut suggestions = Vec::new();
    for candidate in candidates {
        if entity.variants.iter().any(|variant| variant == candidate)
            || suggestions.iter().any(|existing| existing == candidate)
        {
            continue;
        }
        let normalized = normalize_name(candidate);
        if normalized.chars().count() < 2 {
            continue;
        }
        if known.iter().any(|key| related(key, &normalized)) {
            suggestions.push(candidate.to_string());
        }
    }
    suggestions
}

fn related(a: &str, b: &str) -> bool {
    if a == b || a.contains(b) || b.contains(a) {
        return true;
    }
    common_prefix_chars(a, b) >= 3
}

fn common_prefix_chars(a: &str, b: &str) -> usize {
    a.chars()
        .zip(b.chars())
        .take_while(|(left, right)| left == right)
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entity(variants: &[&str]) -> Entity {
        Entity {
            id: "organization-001".to_string(),
            category: "organization".to_string(),
            alias: "開発会社A".to_string(),
            variants: variants.iter().map(|v| v.to_string()).collect(),
            align: None,
        }
    }

    #[test]
    fn normalization_strips_legal_forms_whitespace_and_kana_variants() {
        assert_eq!(normalize_name("株式会社アルファ技研"), "アルファ技研");
        assert_eq!(normalize_name("アル フ ァ技研"), "アルファ技研");
        assert_eq!(normalize_name("株式会社べータ電機"), "ベータ電機");
    }

    #[test]
    fn variants_of_the_same_name_are_suggested() {
        let entity = entity(&["株式会社アルファ技研"]);
        let candidates = [
            "アルファ技研",
            "アルファ社",
            "株式会社ベータ電機",
            "アル フ ァ技研",
        ];

        let suggestions =
            suggest_variants(&entity, candidates.iter().copied());

        assert!(suggestions.contains(&"アルファ技研".to_string()));
        assert!(suggestions.contains(&"アルファ社".to_string()));
        assert!(suggestions.contains(&"アル フ ァ技研".to_string()));
        assert!(!suggestions.contains(&"株式会社ベータ電機".to_string()));
    }

    #[test]
    fn registered_variants_are_not_suggested_again() {
        let entity = entity(&["株式会社アルファ技研", "アルファ技研"]);

        let suggestions =
            suggest_variants(&entity, ["アルファ技研", "アルファ技研工業"].into_iter());

        assert_eq!(suggestions, vec!["アルファ技研工業".to_string()]);
    }
}
