//! Anonymization policy: which findings, texts, and regions to transform,
//! and how.
//!
//! A policy is a YAML document the user reviews and reuses across documents
//! of the same engagement. `plan_page_edits` expands it against a document's
//! OCR results and findings into concrete per-page edits, which are persisted
//! before being applied so every transformation stays auditable.

use std::path::Path;

use menreiki_core::{EditStyle, Finding, PageEdit, PageOcr, Rect, TextAlign};
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
    Replace {
        value: String,
        #[serde(default)]
        align: TextAlign,
    },
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
    // Locate text the same way detection does — over row-merged OCR — or a
    // letter-spaced name that shows up as a candidate would silently produce
    // no edit at apply time.
    let merged: Vec<PageOcr> = ocr_pages
        .iter()
        .map(menreiki_core::merge_row_fragments)
        .collect();

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
            for (page_index, ocr) in merged.iter().enumerate() {
                for finding in detect_page(ocr, &literal) {
                    plans[page_index].push(PageEdit {
                        rect: finding.rect,
                        style: style.clone(),
                    });
                }
            }
            // A rule usually originates from a candidate row; the stored
            // finding rect is authoritative even when OCR never read this
            // exact string (a manually boxed candidate, a text corrected via
            // group assignment). Whole-page rects (位置未特定 VLM candidates)
            // are skipped — blacking the entire page is never intended.
            let needle = strip_ws(text);
            for (page_index, findings) in findings_pages.iter().enumerate() {
                if page_index >= plans.len() {
                    break;
                }
                let page = &ocr_pages[page_index];
                for finding in findings.iter().filter(|f| {
                    strip_ws(&f.text) == needle && !covers_whole_page(&f.rect, page)
                }) {
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
    Ok(plans.into_iter().map(suppress_covered_edits).collect())
}

fn strip_ws(text: &str) -> String {
    text.chars().filter(|c| !c.is_whitespace()).collect()
}

/// Whether a finding rect spans essentially the whole page — the shape of a
/// location-unknown candidate, not a real text position.
fn covers_whole_page(rect: &Rect, page: &PageOcr) -> bool {
    page.width > 0
        && page.height > 0
        && rect.width >= page.width as f32 * 0.85
        && rect.height >= page.height as f32 * 0.85
}

/// Drops edits whose rect is mostly covered by a larger edit on the same
/// page. Nested matches (犬芝重工業株式会社 and 芝重工業) would otherwise both
/// draw, the smaller one re-erasing part of the larger one's replacement and
/// leaving mixed glyph sizes inside a single box.
fn suppress_covered_edits(edits: Vec<PageEdit>) -> Vec<PageEdit> {
    let area = |rect: &Rect| rect.width * rect.height;
    let overlap = |a: &Rect, b: &Rect| {
        let width = (a.x + a.width).min(b.x + b.width) - a.x.max(b.x);
        let height = (a.y + a.height).min(b.y + b.height) - a.y.max(b.y);
        width.max(0.0) * height.max(0.0)
    };
    let mut ordered = edits;
    ordered.sort_by(|a, b| {
        area(&b.rect)
            .partial_cmp(&area(&a.rect))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut kept: Vec<PageEdit> = Vec::new();
    for edit in ordered {
        let own = area(&edit.rect).max(1.0);
        let covered = kept
            .iter()
            .any(|previous| overlap(&previous.rect, &edit.rect) / own >= 0.7);
        if !covered {
            kept.push(edit);
        }
    }
    kept
}

fn edit_style(action: &Action) -> Option<EditStyle> {
    match action {
        Action::Keep => None,
        Action::Remove => Some(EditStyle::Erase),
        Action::Mask => Some(EditStyle::Mask),
        Action::Replace { value, align } => Some(EditStyle::ReplaceText {
            text: value.clone(),
            align: *align,
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
                text: "開発会社A".to_string(),
                align: TextAlign::Center,
            }
        );
        assert!(plans[1].is_empty());
    }

    #[test]
    fn replace_alignment_is_parsed_and_carried_into_the_edit() {
        let policy = parse_policy(
            "rules:\n  - match: { text: 株式会社アルファ }\n    action: { type: replace, value: A, align: right }\n",
        )
        .unwrap();
        let ocr = vec![page_with_text("納入元は株式会社アルファです")];

        let plans = plan_page_edits(&policy, &ocr, &[vec![]]).unwrap();

        assert_eq!(
            plans[0][0].style,
            EditStyle::ReplaceText {
                text: "A".to_string(),
                align: TextAlign::Right,
            }
        );
    }

    fn char_line(text: &str, x: f32) -> OcrLine {
        OcrLine {
            text: text.to_string(),
            words: vec![Span {
                text: text.to_string(),
                rect: Rect {
                    x,
                    y: 100.0,
                    width: 20.0,
                    height: 20.0,
                },
            }],
        }
    }

    #[test]
    fn letter_spaced_candidates_still_get_edits_at_apply_time() {
        // A letter-spaced name reaches OCR as one line per character; detection
        // sees it via row-merging, so apply-time planning must too — otherwise
        // the candidate silently produces no edit.
        let policy = parse_policy(
            "rules:\n  - match: { text: 犬芝工業株式会社 }\n    action: { type: mask }\n",
        )
        .unwrap();
        let chars = ["犬", "芝", "工", "業", "株", "式", "会", "社"];
        let ocr = vec![PageOcr {
            width: 1000,
            height: 1000,
            lines: chars
                .iter()
                .enumerate()
                .map(|(index, character)| char_line(character, index as f32 * 30.0))
                .collect(),
        }];

        let plans = plan_page_edits(&policy, &ocr, &[vec![]]).unwrap();

        assert!(!plans[0].is_empty(), "letter-spaced name produced no edit");
    }

    #[test]
    fn a_pinned_finding_supplies_its_rect_when_ocr_never_read_the_text() {
        // "ここを検出" pins a corrected text at the reviewer's box; OCR misread
        // it, so a literal search finds nothing — the finding rect must be
        // used instead of silently dropping the rule.
        let policy = parse_policy(
            "rules:\n  - match: { text: 犬芝重工業株式会社 }\n    action: { type: mask }\n",
        )
        .unwrap();
        let ocr = vec![page_with_text("納入元は犬芝重工業株式です")];
        let findings = vec![vec![Finding {
            category: "organization".to_string(),
            text: "犬芝重工業株式会社".to_string(),
            rect: Rect {
                x: 40.0,
                y: 40.0,
                width: 180.0,
                height: 22.0,
            },
            detector: "manual".to_string(),
            note: None,
        }]];

        let plans = plan_page_edits(&policy, &ocr, &findings).unwrap();

        assert_eq!(plans[0].len(), 1, "pinned finding produced no edit");
        assert_eq!(plans[0][0].rect.x, 40.0);
    }

    #[test]
    fn an_unlocated_whole_page_finding_never_blacks_the_page() {
        let policy = parse_policy(
            "rules:\n  - match: { text: 図中の機密語 }\n    action: { type: mask }\n",
        )
        .unwrap();
        let ocr = vec![page_with_text("無関係な本文")];
        let findings = vec![vec![Finding {
            category: "other".to_string(),
            text: "図中の機密語".to_string(),
            rect: Rect {
                x: 0.0,
                y: 0.0,
                width: 1000.0,
                height: 1000.0,
            },
            detector: "vlm".to_string(),
            note: Some("位置未特定".to_string()),
        }]];

        let plans = plan_page_edits(&policy, &ocr, &findings).unwrap();

        assert!(
            plans[0].is_empty(),
            "whole-page rect became an edit: {:?}",
            plans[0]
        );
    }

    #[test]
    fn a_nested_match_does_not_double_draw() {
        // Two rules whose matches occupy the same box: without suppression
        // both would draw, the second erasing part of the first's replacement
        // and leaving mixed glyph sizes inside one rect.
        let policy = parse_policy(
            "rules:\n  - match: { text: 犬芝重工業株式会社 }\n    action: { type: replace, value: A社 }\n  - match: { text: 芝重工業 }\n    action: { type: replace, value: B社 }\n",
        )
        .unwrap();
        let ocr = vec![page_with_text("納入元は犬芝重工業株式会社です")];

        let plans = plan_page_edits(&policy, &ocr, &[vec![]]).unwrap();

        assert_eq!(plans[0].len(), 1, "covered edit kept: {:?}", plans[0]);
        assert!(matches!(
            &plans[0][0].style,
            EditStyle::ReplaceText { text, .. } if text == "A社"
        ));
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
