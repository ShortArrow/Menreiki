use serde::Deserialize;

use crate::{InferenceClient, InferenceError};

/// One candidate the model proposed: what it found, how it classified it,
/// and why — the reason is shown to the reviewer as advisory context.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct LlmCandidate {
    pub category: String,
    pub text: String,
    #[serde(default)]
    pub reason: String,
}

/// Something that can propose candidates for a page of text — implemented
/// by [`InferenceClient`], and by test doubles.
pub trait CandidateDetector {
    fn detect(&self, page_text: &str) -> Result<Vec<LlmCandidate>, InferenceError>;
}

impl CandidateDetector for InferenceClient {
    fn detect(&self, page_text: &str) -> Result<Vec<LlmCandidate>, InferenceError> {
        detect_candidates(self, page_text)
    }
}

const SYSTEM_PROMPT: &str = "あなたは機密文書の匿名化レビューを補助するアシスタントです。\
与えられたOCRテキストから、機密情報の可能性がある表現(人物名、組織名、部署名、製品名や型式、\
施設名、所在地、管理番号などの識別子)を抽出してください。\
出力はJSON配列のみとし、各要素は {\"category\": カテゴリ, \"text\": 原文のままの文字列, \
\"reason\": 一文の理由} とします。\
categoryは organization / person / department / product / place / identifier / other の\
いずれかを使ってください。textは本文からそのまま抜き出し、言い換えないでください。\
確実でないものも候補として含めてかまいません。JSON以外の文字を出力しないでください。";

/// Something that can propose candidates for a page image — implemented
/// by [`InferenceClient`] (requires a vision model), and by test doubles.
pub trait ImageCandidateDetector {
    fn detect_image(&self, png: &[u8]) -> Result<Vec<LlmCandidate>, InferenceError>;
}

impl ImageCandidateDetector for InferenceClient {
    fn detect_image(&self, png: &[u8]) -> Result<Vec<LlmCandidate>, InferenceError> {
        detect_candidates_in_image(self, png)
    }
}

/// Asks the local model for anonymization candidates in `page_text`.
pub fn detect_candidates(
    client: &InferenceClient,
    page_text: &str,
) -> Result<Vec<LlmCandidate>, InferenceError> {
    let content = client.chat(SYSTEM_PROMPT, page_text)?;
    parse_candidates(&content)
}

const IMAGE_USER_PROMPT: &str = "このページ画像を確認し、機密情報の可能性がある表現を\
抽出してください。本文だけでなく、図表・グラフ・スクリーンショット・ロゴ・印影・\
ヘッダーやフッターの中の文字列にも注意してください。";

/// Asks the local vision model for anonymization candidates visible in a
/// page image — including text inside figures and screenshots that OCR
/// may have missed.
pub fn detect_candidates_in_image(
    client: &InferenceClient,
    png: &[u8],
) -> Result<Vec<LlmCandidate>, InferenceError> {
    let content = client.chat_with_image(SYSTEM_PROMPT, IMAGE_USER_PROMPT, png)?;
    parse_candidates(&content)
}

/// Parses the model output, tolerating code fences and prose around the
/// JSON array — small local models rarely follow format instructions
/// perfectly.
pub fn parse_candidates(content: &str) -> Result<Vec<LlmCandidate>, InferenceError> {
    let json = extract_json_array(content)?;
    let candidates: Vec<LlmCandidate> = serde_json::from_str(&json)
        .map_err(|error| InferenceError::Response(error.to_string()))?;
    Ok(candidates
        .into_iter()
        .filter(|candidate| !candidate.text.trim().is_empty())
        .collect())
}

/// Isolates the outermost JSON array from model output and repairs the
/// mistakes small local models make most: code fences, prose around the
/// array, and trailing commas before a closing `]`/`}` (which strict JSON
/// forbids but many models emit).
fn extract_json_array(content: &str) -> Result<String, InferenceError> {
    let start = content
        .find('[')
        .ok_or_else(|| InferenceError::Response("no JSON array in model output".to_string()))?;
    let end = content
        .rfind(']')
        .ok_or_else(|| InferenceError::Response("unterminated JSON array".to_string()))?;
    if end < start {
        return Err(InferenceError::Response(
            "malformed JSON array in model output".to_string(),
        ));
    }
    Ok(strip_trailing_commas(&content[start..=end]))
}

/// Removes commas that immediately precede a closing `]` or `}` (ignoring
/// whitespace), while leaving commas inside string literals untouched.
fn strip_trailing_commas(json: &str) -> String {
    let bytes = json.as_bytes();
    let mut out = String::with_capacity(json.len());
    let mut in_string = false;
    let mut escaped = false;
    for (index, ch) in json.char_indices() {
        if in_string {
            out.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        if ch == '"' {
            in_string = true;
            out.push(ch);
            continue;
        }
        if ch == ',' {
            let next = bytes[index + 1..]
                .iter()
                .find(|byte| !byte.is_ascii_whitespace());
            if matches!(next, Some(b']') | Some(b'}')) {
                continue;
            }
        }
        out.push(ch);
    }
    out
}

const REPLACEMENT_SYSTEM_PROMPT: &str = "あなたは機密文書の匿名化を補助するアシスタントです。\
与えられた表現の代わりに使える置換候補を提案してください。置換候補は、元の対象を特定\
できないようにしつつ、文書の技術的・役割的な意味を保つものにします。\
例: 特定のマイコン型式には「Cortex-M7系マイクロコントローラA」のように技術分類を残す。\
社名には「発注元企業A」「供給会社B」のように役割を残す。施設名には「試験施設A」のように\
種類を残す。JSON配列（文字列のみ、2〜4件）だけを出力し、それ以外の文字を出力しないで\
ください。";

/// Asks the local model for replacement expressions that strip identity
/// while keeping technical or role meaning (pseudonymization and
/// generalization suggestions). `context` may carry surrounding text.
pub fn suggest_replacements(
    client: &InferenceClient,
    text: &str,
    category: &str,
    context: &str,
) -> Result<Vec<String>, InferenceError> {
    let user = if context.trim().is_empty() {
        format!("分類: {category}\n表現: {text}")
    } else {
        format!("分類: {category}\n表現: {text}\n文脈: {context}")
    };
    let content = client.chat(REPLACEMENT_SYSTEM_PROMPT, &user)?;
    parse_suggestions(&content)
}

/// Parses a JSON array of strings from the model output, with the same
/// tolerance for fences and prose as candidate parsing.
pub fn parse_suggestions(content: &str) -> Result<Vec<String>, InferenceError> {
    let json = extract_json_array(content)?;
    let suggestions: Vec<String> = serde_json::from_str(&json)
        .map_err(|error| InferenceError::Response(error.to_string()))?;
    Ok(suggestions
        .into_iter()
        .map(|suggestion| suggestion.trim().to_string())
        .filter(|suggestion| !suggestion.is_empty())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_replacement_suggestions_with_fences() {
        let output = "```json\n[\"Cortex-M7系マイクロコントローラA\", \"制御用マイコンA\", \" \"]\n```";

        let suggestions = parse_suggestions(output).unwrap();

        assert_eq!(
            suggestions,
            vec![
                "Cortex-M7系マイクロコントローラA".to_string(),
                "制御用マイコンA".to_string(),
            ]
        );
    }

    #[test]
    fn parses_a_bare_json_array() {
        let output = r#"[{"category":"organization","text":"株式会社アルファ技研","reason":"社名"}]"#;

        let candidates = parse_candidates(output).unwrap();

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].category, "organization");
        assert_eq!(candidates[0].text, "株式会社アルファ技研");
    }

    #[test]
    fn tolerates_code_fences_and_prose() {
        let output = "以下が候補です。\n```json\n[\n {\"category\":\"person\",\"text\":\"田中太郎\",\"reason\":\"人名\"}\n]\n```\n以上です。";

        let candidates = parse_candidates(output).unwrap();

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].text, "田中太郎");
    }

    #[test]
    fn empty_texts_are_dropped_and_missing_reason_defaults() {
        let output = r#"[{"category":"other","text":"  "},{"category":"place","text":"横浜市"}]"#;

        let candidates = parse_candidates(output).unwrap();

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].text, "横浜市");
        assert_eq!(candidates[0].reason, "");
    }

    #[test]
    fn output_without_json_is_an_error() {
        assert!(parse_candidates("すみません、候補は見つかりませんでした。").is_err());
    }

    #[test]
    fn tolerates_trailing_commas_before_closing_brackets() {
        let output = "[\n  {\"category\":\"person\",\"text\":\"田中太郎\",\"reason\":\"人名\",},\n]";

        let candidates = parse_candidates(output).unwrap();

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].text, "田中太郎");
    }

    #[test]
    fn a_comma_inside_a_string_is_preserved() {
        let output = r#"["A株式会社, B事業部",]"#;

        let suggestions = parse_suggestions(output).unwrap();

        assert_eq!(suggestions, vec!["A株式会社, B事業部".to_string()]);
    }
}
