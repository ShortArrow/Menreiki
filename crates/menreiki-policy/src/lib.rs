//! Anonymization policy: which findings, texts, and regions to transform,
//! and how.
//!
//! A policy is a YAML document the user reviews and reuses across documents
//! of the same engagement. `plan_page_edits` expands it against a document's
//! OCR results and findings into concrete per-page edits, which are persisted
//! before being applied so every transformation stays auditable.

use std::path::Path;

use menreiki_core::{EditStyle, Finding, PageEdit, PageOcr, Rect};
use menreiki_detect::detect_page;
use menreiki_lang_ja::literal_rule;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Policy {
    pub rules: Vec<Rule>,
}

#[derive(Debug, Deserialize)]
pub struct Rule {
    #[serde(default)]
    pub name: Option<String>,
    pub r#match: Match,
    pub action: Action,
}

/// What a rule applies to. Fields combine as alternatives: a rule may match
/// a finding category, a verbatim text, and/or a fixed page region.
#[derive(Debug, Default, Deserialize)]
pub struct Match {
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub region: Option<Rect>,
    /// Pages a `region` applies to: `all` or a list of 1-based page numbers.
    #[serde(default)]
    pub pages: Option<PageScope>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum PageScope {
    Pages(Vec<u16>),
    Keyword(String),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Action {
    Keep,
    Remove,
    Mask,
    Replace { value: String },
}

#[derive(Debug, thiserror::Error)]
pub enum PolicyError {
    #[error("policy file could not be read: {0}")]
    Read(std::io::Error),
    #[error("policy is not valid: {0}")]
    Parse(#[from] serde_yaml::Error),
}

pub fn load_policy(path: &Path) -> Result<Policy, PolicyError> {
    let text = std::fs::read_to_string(path).map_err(PolicyError::Read)?;
    parse_policy(&text)
}

pub fn parse_policy(yaml: &str) -> Result<Policy, PolicyError> {
    Ok(serde_yaml::from_str(yaml)?)
}

#[derive(Debug, thiserror::Error)]
pub enum PlanError {
    #[error("unknown page scope keyword: {0} (expected \"all\" or a page list)")]
    UnknownPageScope(String),
}

/// Expands a policy into one edit list per page.
///
/// `findings_pages` must be indexed by 0-based page like `ocr_pages`; page
/// numbers inside the policy are 1-based, matching what the user sees.
pub fn plan_page_edits(
    policy: &Policy,
    ocr_pages: &[PageOcr],
    findings_pages: &[Vec<Finding>],
) -> Result<Vec<Vec<PageEdit>>, PlanError> {
    let mut plans: Vec<Vec<PageEdit>> = vec![Vec::new(); ocr_pages.len()];

    for rule in &policy.rules {
        let Some(style) = edit_style(&rule.action) else {
            continue;
        };

        if let Some(category) = &rule.r#match.category {
            for (page_index, findings) in findings_pages.iter().enumerate() {
                if page_index >= plans.len() {
                    break;
                }
                for finding in findings.iter().filter(|f| &f.category == category) {
                    plans[page_index].push(PageEdit {
                        rect: finding.rect,
                        style: style.clone(),
                    });
                }
            }
        }

        if let Some(text) = &rule.r#match.text {
            let literal = [literal_rule("policy-text", text)];
            for (page_index, ocr) in ocr_pages.iter().enumerate() {
                for finding in detect_page(ocr, &literal) {
                    plans[page_index].push(PageEdit {
                        rect: finding.rect,
                        style: style.clone(),
                    });
                }
            }
        }

        if let Some(region) = &rule.r#match.region {
            let scope = rule.r#match.pages.clone();
            for page_index in 0..plans.len() {
                if scope_contains(&scope, page_index as u16 + 1)? {
                    plans[page_index].push(PageEdit {
                        rect: *region,
                        style: style.clone(),
                    });
                }
            }
        }
    }
    Ok(plans)
}

fn edit_style(action: &Action) -> Option<EditStyle> {
    match action {
        Action::Keep => None,
        Action::Remove => Some(EditStyle::Erase),
        Action::Mask => Some(EditStyle::Mask),
        Action::Replace { value } => Some(EditStyle::ReplaceText {
            text: value.clone(),
        }),
    }
}

fn scope_contains(scope: &Option<PageScope>, page_number: u16) -> Result<bool, PlanError> {
    match scope {
        None => Ok(true),
        Some(PageScope::Pages(pages)) => Ok(pages.contains(&page_number)),
        Some(PageScope::Keyword(keyword)) if keyword == "all" => Ok(true),
        Some(PageScope::Keyword(keyword)) => Err(PlanError::UnknownPageScope(keyword.clone())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use menreiki_core::{OcrLine, Span};

    fn page_with_text(text: &str) -> PageOcr {
        PageOcr {
            width: 1000,
            height: 1000,
            lines: vec![OcrLine {
                text: text.to_string(),
                words: vec![Span {
                    text: text.to_string(),
                    rect: Rect {
                        x: 10.0,
                        y: 10.0,
                        width: 200.0,
                        height: 20.0,
                    },
                }],
            }],
        }
    }

    fn email_finding() -> Finding {
        Finding {
            category: "email".to_string(),
            text: "taro@example.com".to_string(),
            rect: Rect {
                x: 50.0,
                y: 50.0,
                width: 100.0,
                height: 20.0,
            },
            detector: "regex".to_string(),
            note: None,
        }
    }

    #[test]
    fn parses_yaml_policy() {
        let policy = parse_policy(
            r#"
rules:
  - name: mask emails
    match:
      category: email
    action:
      type: mask
  - match:
      region: { x: 0, y: 900, width: 1000, height: 100 }
      pages: all
    action:
      type: remove
  - match:
      text: 株式会社アルファ
    action:
      type: replace
      value: 開発会社A
"#,
        )
        .unwrap();

        assert_eq!(policy.rules.len(), 3);
    }

    #[test]
    fn category_rule_edits_matching_findings() {
        let policy = parse_policy(
            "rules:\n  - match: { category: email }\n    action: { type: mask }\n",
        )
        .unwrap();
        let ocr = vec![page_with_text("body"), page_with_text("body")];
        let findings = vec![vec![email_finding()], vec![]];

        let plans = plan_page_edits(&policy, &ocr, &findings).unwrap();

        assert_eq!(plans[0].len(), 1);
        assert_eq!(plans[0][0].style, EditStyle::Mask);
        assert_eq!(plans[0][0].rect, email_finding().rect);
        assert!(plans[1].is_empty());
    }

    #[test]
    fn text_rule_finds_matches_in_ocr_directly() {
        let policy = parse_policy(
            "rules:\n  - match: { text: 株式会社アルファ }\n    action: { type: replace, value: 開発会社A }\n",
        )
        .unwrap();
        let ocr = vec![
            page_with_text("納入元は株式会社アルファです"),
            page_with_text("無関係なページ"),
        ];
        let findings = vec![vec![], vec![]];

        let plans = plan_page_edits(&policy, &ocr, &findings).unwrap();

        assert_eq!(plans[0].len(), 1);
        assert_eq!(
            plans[0][0].style,
            EditStyle::ReplaceText {
                text: "開発会社A".to_string()
            }
        );
        assert!(plans[1].is_empty());
    }

    #[test]
    fn region_rule_applies_to_selected_pages_only() {
        let policy = parse_policy(
            "rules:\n  - match:\n      region: { x: 0, y: 900, width: 1000, height: 100 }\n      pages: [2]\n    action: { type: remove }\n",
        )
        .unwrap();
        let ocr = vec![page_with_text("one"), page_with_text("two")];
        let findings = vec![vec![], vec![]];

        let plans = plan_page_edits(&policy, &ocr, &findings).unwrap();

        assert!(plans[0].is_empty());
        assert_eq!(plans[1].len(), 1);
        assert_eq!(plans[1][0].style, EditStyle::Erase);
    }

    #[test]
    fn keep_rule_produces_no_edits() {
        let policy =
            parse_policy("rules:\n  - match: { category: email }\n    action: { type: keep }\n")
                .unwrap();
        let ocr = vec![page_with_text("body")];
        let findings = vec![vec![email_finding()]];

        let plans = plan_page_edits(&policy, &ocr, &findings).unwrap();

        assert!(plans[0].is_empty());
    }

    #[test]
    fn unknown_page_scope_keyword_is_an_error() {
        let policy = parse_policy(
            "rules:\n  - match:\n      region: { x: 0, y: 0, width: 10, height: 10 }\n      pages: odd\n    action: { type: remove }\n",
        )
        .unwrap();

        let result = plan_page_edits(&policy, &[page_with_text("one")], &[vec![]]);

        assert!(matches!(result, Err(PlanError::UnknownPageScope(_))));
    }
}
