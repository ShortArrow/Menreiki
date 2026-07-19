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

/// Asks the local model for anonymization candidates in `page_text`.
pub fn detect_candidates(
    client: &InferenceClient,
    page_text: &str,
) -> Result<Vec<LlmCandidate>, InferenceError> {
    let content = client.chat(SYSTEM_PROMPT, page_text)?;
    parse_candidates(&content)
}

/// Parses the model output, tolerating code fences and prose around the
/// JSON array — small local models rarely follow format instructions
/// perfectly.
pub fn parse_candidates(content: &str) -> Result<Vec<LlmCandidate>, InferenceError> {
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
    let candidates: Vec<LlmCandidate> = serde_json::from_str(&content[start..=end])
        .map_err(|error| InferenceError::Response(error.to_string()))?;
    Ok(candidates
        .into_iter()
        .filter(|candidate| !candidate.text.trim().is_empty())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
