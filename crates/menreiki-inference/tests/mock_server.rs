use std::io::{Read, Write};
use std::net::TcpListener;

use menreiki_inference::InferenceClient;

/// A one-shot OpenAI-compatible server on an ephemeral local port.
fn serve_one(response_content: &str) -> (std::thread::JoinHandle<String>, u16) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let body = serde_json::json!({
        "choices": [ { "message": { "role": "assistant", "content": response_content } } ]
    })
    .to_string();

    let handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buffer = [0u8; 65536];
        let mut request = String::new();
        loop {
            let read = stream.read(&mut buffer).unwrap();
            request.push_str(&String::from_utf8_lossy(&buffer[..read]));
            if let Some(headers_end) = request.find("\r\n\r\n") {
                let content_length = request
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(|value| value.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                if request.len() >= headers_end + 4 + content_length {
                    break;
                }
            }
        }
        let http = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream.write_all(http.as_bytes()).unwrap();
        request
    });
    (handle, port)
}

/// A one-shot server that replies with `body` verbatim, for endpoints (like
/// `/models`) that are not chat-completion shaped.
fn serve_raw(body: String) -> (std::thread::JoinHandle<String>, u16) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buffer = [0u8; 65536];
        let read = stream.read(&mut buffer).unwrap();
        let request = String::from_utf8_lossy(&buffer[..read]).to_string();
        let http = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream.write_all(http.as_bytes()).unwrap();
        request
    });
    (handle, port)
}

#[test]
fn list_models_reads_the_models_endpoint() {
    let (server, port) = serve_raw(
        r#"{"object":"list","data":[{"id":"qwen3"},{"id":"llava"}]}"#.to_string(),
    );

    let ids = menreiki_inference::list_models(&format!("http://127.0.0.1:{port}/v1")).unwrap();

    assert_eq!(ids, vec!["qwen3".to_string(), "llava".to_string()]);
    let request = server.join().unwrap();
    assert!(request.contains("GET /v1/models"));
}

#[test]
fn chat_round_trips_through_an_openai_compatible_server() {
    let (server, port) = serve_one("こんにちは、候補はありません。[]");
    let client =
        InferenceClient::new(&format!("http://127.0.0.1:{port}/v1"), "test-model").unwrap();

    let content = client.chat("system prompt", "user text").unwrap();

    assert_eq!(content, "こんにちは、候補はありません。[]");
    let request = server.join().unwrap();
    assert!(request.contains("POST /v1/chat/completions"));
    assert!(request.contains("test-model"));
    assert!(request.contains("user text"));
}

#[test]
fn image_chat_sends_a_data_url_in_the_vision_content_format() {
    use menreiki_inference::ImageCandidateDetector;

    let (server, port) = serve_one(r#"[{"category":"other","text":"社外秘","reason":"透かし"}]"#);
    let client =
        InferenceClient::new(&format!("http://127.0.0.1:{port}/v1"), "vision-model").unwrap();

    let candidates = client.detect_image(b"fake png bytes").unwrap();

    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].text, "社外秘");
    let request = server.join().unwrap();
    assert!(request.contains("image_url"));
    assert!(request.contains("data:image/png;base64,"));
}

#[test]
fn replacement_suggestions_round_trip() {
    let (server, port) =
        serve_one(r#"["Cortex-M7系マイクロコントローラA", "制御用マイコンA"]"#);
    let client =
        InferenceClient::new(&format!("http://127.0.0.1:{port}/v1"), "test-model").unwrap();

    let suggestions = menreiki_inference::suggest_replacements(
        &client,
        "STM32H750VBT6",
        "product",
        "FDCAN1を使用して1 Mbpsで通信する",
    )
    .unwrap();

    assert_eq!(suggestions.len(), 2);
    assert_eq!(suggestions[0], "Cortex-M7系マイクロコントローラA");
    let request = server.join().unwrap();
    assert!(request.contains("STM32H750VBT6"));
    assert!(request.contains("FDCAN1"));
}

#[test]
fn candidate_detection_parses_the_model_answer() {
    use menreiki_inference::CandidateDetector;

    let (server, port) = serve_one(
        r#"```json
[{"category":"organization","text":"株式会社アルファ技研","reason":"社名と思われる"}]
```"#,
    );
    let client =
        InferenceClient::new(&format!("http://127.0.0.1:{port}/v1"), "test-model").unwrap();

    let candidates = client.detect("本文テキスト").unwrap();

    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].text, "株式会社アルファ技研");
    assert_eq!(candidates[0].reason, "社名と思われる");
    server.join().unwrap();
}
