//! Detector packs — shareable, data-only bundles of detection content:
//! regex rules and OCR-tolerantly matched literal words (ADR-016). Being
//! data only, a pack is fully auditable and needs no sandbox; loading just
//! converts it into the same [`RegexRule`]s the built-in detectors use,
//! attributed to `pack:<name>` so every finding stays traceable.

use serde::{Deserialize, Serialize};

use crate::{literal_rule, RegexRule};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectorPack {
    /// Unique slug: lowercase letters, digits, hyphens.
    pub name: String,
    pub display_name: String,
    pub version: String,
    #[serde(default)]
    pub publisher: String,
    #[serde(default)]
    pub description: String,
    /// Regex rules; every pattern must compile or the pack is rejected.
    #[serde(default)]
    pub rules: Vec<PackRule>,
    /// Literal words, matched with the same OCR tolerance as the user
    /// dictionary.
    #[serde(default)]
    pub words: Vec<PackWord>,
    /// Reserved for the signed-distribution phase; not verified yet
    /// (verification is meaningless without a publisher trust root).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackRule {
    pub category: String,
    pub pattern: String,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackWord {
    pub category: String,
    pub text: String,
}

#[derive(Debug, thiserror::Error)]
pub enum PackError {
    #[error("pack is not valid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid pack: {0}")]
    Invalid(String),
}

/// Parses and validates a detector pack. Unknown JSON fields are tolerated
/// for forward compatibility; everything the pack *does* declare must be
/// usable, or the whole pack is rejected.
pub fn parse_pack(json: &str) -> Result<DetectorPack, PackError> {
    let pack: DetectorPack = serde_json::from_str(json)?;

    if pack.name.is_empty()
        || !pack
            .name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(PackError::Invalid(format!(
            "name must be a lowercase slug (a-z, 0-9, -): {:?}",
            pack.name
        )));
    }
    if pack.display_name.trim().is_empty() {
        return Err(PackError::Invalid("displayName is empty".to_string()));
    }
    if pack.version.trim().is_empty() {
        return Err(PackError::Invalid("version is empty".to_string()));
    }
    if pack.rules.is_empty() && pack.words.is_empty() {
        return Err(PackError::Invalid(
            "pack declares neither rules nor words".to_string(),
        ));
    }
    for rule in &pack.rules {
        if rule.category.trim().is_empty() {
            return Err(PackError::Invalid("a rule has an empty category".to_string()));
        }
        RegexRule::new(&rule.category, &rule.pattern).map_err(|error| {
            PackError::Invalid(format!(
                "rule '{}' has an invalid pattern: {}",
                rule.category, error
            ))
        })?;
    }
    for word in &pack.words {
        if word.category.trim().is_empty() || word.text.trim().is_empty() {
            return Err(PackError::Invalid(
                "a word entry has an empty category or text".to_string(),
            ));
        }
    }
    Ok(pack)
}

impl DetectorPack {
    /// Everything the pack contributes to detection, attributed to
    /// `pack:<name>`.
    pub fn detection_rules(&self) -> Vec<RegexRule> {
        let detector = format!("pack:{}", self.name);
        let mut rules: Vec<RegexRule> = self
            .rules
            .iter()
            .map(|rule| {
                RegexRule::new(&rule.category, &rule.pattern)
                    .expect("patterns were validated by parse_pack")
                    .with_detector(&detector)
            })
            .collect();
        rules.extend(
            self.words
                .iter()
                .map(|word| literal_rule(&word.category, &word.text).with_detector(&detector)),
        );
        rules
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use menreiki_core::{OcrLine, PageOcr, Rect, Span};

    // Same realistic shape as lib.rs tests: CJK OCR yields one word per
    // character with a tight box.
    fn page_with_line(text: &str) -> PageOcr {
        let mut x = 0.0;
        let mut words = Vec::new();
        for character in text.chars() {
            if character.is_whitespace() {
                x += 15.0;
                continue;
            }
            words.push(Span {
                text: character.to_string(),
                rect: Rect {
                    x,
                    y: 10.0,
                    width: 20.0,
                    height: 20.0,
                },
            });
            x += 25.0;
        }
        PageOcr {
            width: 1000,
            height: 100,
            lines: vec![OcrLine {
                text: text.to_string(),
                words,
            }],
        }
    }

    const SAMPLE: &str = r#"{
        "name": "sample-fictional",
        "displayName": "架空メーカー検出パック",
        "version": "1.0.0",
        "publisher": "ShortArrow",
        "rules": [
            { "category": "model-number", "pattern": "MNR-\\d{4}", "note": "架空の型番体系" }
        ],
        "words": [
            { "category": "organization", "text": "猫埼電工" }
        ]
    }"#;

    #[test]
    fn parses_and_contributes_attributed_rules() {
        let pack = parse_pack(SAMPLE).unwrap();
        assert_eq!(pack.name, "sample-fictional");
        let rules = pack.detection_rules();
        assert_eq!(rules.len(), 2);

        let page = page_with_line("型式 MNR-0042 は猫埼電工の製品");
        let findings = menreiki_detect::detect_page(&page, &rules);
        let mut pairs: Vec<(&str, &str)> = findings
            .iter()
            .map(|finding| (finding.category.as_str(), finding.detector.as_str()))
            .collect();
        pairs.sort();
        assert!(pairs.contains(&("model-number", "pack:sample-fictional")));
        assert!(pairs.contains(&("organization", "pack:sample-fictional")));
    }

    #[test]
    fn words_match_with_ocr_tolerance() {
        let pack = parse_pack(SAMPLE).unwrap();
        // Letter-spaced text, the way CJK OCR often reads it.
        let page = page_with_line("猫 埼 電 工");
        let findings = menreiki_detect::detect_page(&page, &pack.detection_rules());
        assert!(
            findings.iter().any(|f| f.category == "organization"),
            "spaced word not matched: {findings:?}"
        );
    }

    #[test]
    fn rejects_an_invalid_pattern() {
        let json = r#"{ "name": "bad", "displayName": "x", "version": "1",
            "rules": [ { "category": "c", "pattern": "([" } ] }"#;
        assert!(matches!(parse_pack(json), Err(PackError::Invalid(_))));
    }

    #[test]
    fn rejects_a_bad_slug_and_an_empty_pack() {
        let bad_slug = r#"{ "name": "Bad Name", "displayName": "x", "version": "1",
            "words": [ { "category": "c", "text": "t" } ] }"#;
        assert!(matches!(parse_pack(bad_slug), Err(PackError::Invalid(_))));

        let empty = r#"{ "name": "empty", "displayName": "x", "version": "1" }"#;
        assert!(matches!(parse_pack(empty), Err(PackError::Invalid(_))));
    }

    #[test]
    fn tolerates_unknown_fields_for_forward_compatibility() {
        let json = r#"{ "name": "future", "displayName": "x", "version": "1",
            "futureField": { "anything": true },
            "words": [ { "category": "c", "text": "t", "futureFlag": 1 } ] }"#;
        assert!(parse_pack(json).is_ok());
    }
}
