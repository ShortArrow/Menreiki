//! Thin client for an OpenAI-compatible inference API running on this
//! machine.
//!
//! The endpoint is restricted to localhost by construction: confidential
//! text must never leave the machine, so a client that could be pointed at
//! a remote host is not offered at all. llama.cpp server, Ollama,
//! LM Studio, and mistral.rs all expose this API shape, which keeps
//! Menreiki independent of any specific model or runtime.

use std::time::Duration;

use serde::Deserialize;

mod assist;

pub use assist::{
    detect_candidates, detect_candidates_in_image, parse_candidates, CandidateDetector,
    ImageCandidateDetector, LlmCandidate,
};

#[derive(Debug, thiserror::Error)]
pub enum InferenceError {
    #[error("inference endpoint must be on this machine (localhost / 127.0.0.1 / ::1): {0}")]
    NotLocal(String),
    #[error("endpoint URL is invalid: {0}")]
    InvalidUrl(String),
    #[error("model name is not configured")]
    ModelMissing,
    #[error("request failed: {0}")]
    Request(String),
    #[error("response is not usable: {0}")]
    Response(String),
}

pub struct InferenceClient {
    base_url: String,
    model: String,
    agent: ureq::Agent,
}

impl InferenceClient {
    /// Connects to an OpenAI-compatible endpoint, e.g.
    /// `http://localhost:11434/v1` (Ollama) or `http://localhost:1234/v1`
    /// (LM Studio). Refuses any host other than the local machine.
    pub fn new(base_url: &str, model: &str) -> Result<Self, InferenceError> {
        ensure_local(base_url)?;
        if model.trim().is_empty() {
            return Err(InferenceError::ModelMissing);
        }
        Ok(Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            model: model.to_string(),
            agent: ureq::AgentBuilder::new()
                .timeout(Duration::from_secs(300))
                .build(),
        })
    }

    /// One chat-completion round trip, returning the assistant's text.
    pub fn chat(&self, system: &str, user: &str) -> Result<String, InferenceError> {
        self.complete(system, serde_json::Value::String(user.to_string()))
    }

    /// Like [`Self::chat`], with a PNG attached as vision input (data URL
    /// in the OpenAI-compatible image content format). Requires the
    /// configured model to be a vision model.
    pub fn chat_with_image(
        &self,
        system: &str,
        user: &str,
        png: &[u8],
    ) -> Result<String, InferenceError> {
        use base64::Engine;
        let data_url = format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(png)
        );
        let content = serde_json::json!([
            { "type": "text", "text": user },
            { "type": "image_url", "image_url": { "url": data_url } },
        ]);
        self.complete(system, content)
    }

    fn complete(
        &self,
        system: &str,
        user_content: serde_json::Value,
    ) -> Result<String, InferenceError> {
        #[derive(Deserialize)]
        struct Completion {
            choices: Vec<Choice>,
        }
        #[derive(Deserialize)]
        struct Choice {
            message: Message,
        }
        #[derive(Deserialize)]
        struct Message {
            content: String,
        }

        let body = serde_json::json!({
            "model": self.model,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user_content },
            ],
            "temperature": 0.1,
        });
        let completion: Completion = self
            .agent
            .post(&format!("{}/chat/completions", self.base_url))
            .set("Content-Type", "application/json")
            .send_string(&body.to_string())
            .map_err(|error| InferenceError::Request(error.to_string()))?
            .into_json()
            .map_err(|error| InferenceError::Response(error.to_string()))?;
        completion
            .choices
            .into_iter()
            .next()
            .map(|choice| choice.message.content)
            .ok_or_else(|| InferenceError::Response("no choices in completion".to_string()))
    }
}

const LOCAL_HOSTS: [&str; 4] = ["localhost", "127.0.0.1", "[::1]", "::1"];

fn ensure_local(url: &str) -> Result<(), InferenceError> {
    let rest = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))
        .ok_or_else(|| InferenceError::InvalidUrl(url.to_string()))?;
    let host = if let Some(bracketed) = rest.strip_prefix('[') {
        let end = bracketed
            .find(']')
            .ok_or_else(|| InferenceError::InvalidUrl(url.to_string()))?;
        &rest[..end + 2]
    } else {
        rest.split(['/', ':']).next().unwrap_or("")
    };
    if LOCAL_HOSTS.contains(&host) {
        Ok(())
    } else {
        Err(InferenceError::NotLocal(host.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_endpoints_are_accepted() {
        for url in [
            "http://localhost:11434/v1",
            "http://127.0.0.1:1234/v1",
            "http://[::1]:8080/v1",
        ] {
            assert!(InferenceClient::new(url, "some-model").is_ok(), "{url}");
        }
    }

    #[test]
    fn remote_endpoints_are_refused() {
        for url in [
            "http://api.openai.com/v1",
            "https://example.com/v1",
            "http://192.168.1.10:11434/v1",
            "http://localhost.evil.example/v1",
        ] {
            assert!(
                matches!(
                    InferenceClient::new(url, "some-model"),
                    Err(InferenceError::NotLocal(_))
                ),
                "{url}"
            );
        }
    }

    #[test]
    fn a_model_name_is_required() {
        assert!(matches!(
            InferenceClient::new("http://localhost:11434/v1", "  "),
            Err(InferenceError::ModelMissing)
        ));
    }
}
