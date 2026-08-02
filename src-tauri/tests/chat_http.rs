//! HTTP integration tests for the completion client.
//!
//! Each test starts a minimal TCP server that records the request and
//! responds with a canned chat-completions JSON body.

use literative_lib::ai_client::chat::{
    self, ChatCompletionRequest, ChatMessage,
};
use literative_lib::settings::CompletionSettings;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;

fn find_headers_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n").map(|p| p + 4)
}

fn content_length(buf: &[u8], headers_end: usize) -> Option<usize> {
    let headers = String::from_utf8_lossy(&buf[..headers_end]).to_lowercase();
    headers
        .lines()
        .find_map(|line| line.strip_prefix("content-length:"))
        .and_then(|value| value.trim().parse().ok())
}

fn read_full_request(stream: &mut TcpStream) -> String {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if let Some(header_end) = find_headers_end(&buf) {
                    match content_length(&buf, header_end) {
                        Some(len) if buf.len() >= header_end + len => break,
                        None => break,
                        _ => {}
                    }
                }
            }
            Err(_) => break,
        }
    }
    String::from_utf8_lossy(&buf).to_string()
}

/// Serve one HTTP request. Returns the port and a handle on the request text.
fn run_server(
    respond: impl FnOnce(&str) -> (u16, String) + Send + 'static,
) -> (u16, Arc<Mutex<Option<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = Arc::new(Mutex::new(None));
    let seen_clone = seen.clone();
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let request = read_full_request(&mut stream);
        let (status, body) = respond(&request);
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = stream.write_all(response.as_bytes());
        *seen_clone.lock().unwrap() = Some(request);
    });
    (port, seen)
}

fn completion_config(port: u16) -> CompletionSettings {
    CompletionSettings {
        base_url: format!("http://127.0.0.1:{port}"),
        api_key: "completion-key".into(),
        model: "agent-model".into(),
    }
}

fn simple_request() -> ChatCompletionRequest {
    ChatCompletionRequest {
        model: "ignored-by-server".into(),
        messages: vec![ChatMessage {
            role: "user".into(),
            content: "make a poster".into(),
            tool_calls: None,
            tool_call_id: None,
        }],
        tools: vec![],
        tool_choice: None,
        temperature: None,
    }
}

#[tokio::test]
async fn completion_posts_to_chat_endpoint_and_parses_tool_calls() {
    let (port, seen) = run_server(|_| {
        (
            200,
            r#"{
              "choices": [{
                "message": {
                  "content": null,
                  "tool_calls": [{
                    "id": "call-1",
                    "type": "function",
                    "function": {
                      "name": "place_object",
                      "arguments": "{\"kind\":\"rect\",\"x\":10,\"y\":20,\"width\":50,\"height\":30}"
                    }
                  }]
                },
                "finish_reason": "tool_calls"
              }]
            }"#
            .into(),
        )
    });
    let response = chat::complete(&completion_config(port), simple_request())
        .await
        .unwrap();
    assert_eq!(response.choices.len(), 1);
    let message = &response.choices[0].message;
    assert_eq!(message.tool_calls.len(), 1);
    let call = &message.tool_calls[0];
    assert_eq!(call.function.name, "place_object");
    assert!(call.function.arguments.contains("\"kind\":\"rect\""));
    assert_eq!(response.choices[0].finish_reason.as_deref(), Some("tool_calls"));

    let request = seen.lock().unwrap().clone().unwrap();
    assert!(request.contains("/chat/completions"));
    assert!(request.contains("\"model\":\"agent-model\""));
    assert!(request.contains("\"role\":\"user\""));
    assert!(request.contains("make a poster"));
    let lower = request.to_lowercase();
    assert!(lower.contains("authorization: bearer"), "{lower}");
    assert!(request.contains("completion-key"), "{request}");
}

#[tokio::test]
async fn completion_sends_tool_definitions_when_requested() {
    let (port, seen) = run_server(|_| {
        (
            200,
            r#"{"choices":[{"message":{"content":"done"},"finish_reason":"stop"}]}"#
                .into(),
        )
    });
    let mut request = simple_request();
    request.tools = chat::tool_definitions();
    request.tool_choice = Some("auto".into());
    chat::complete(&completion_config(port), request).await.unwrap();

    let raw = seen.lock().unwrap().clone().unwrap();
    assert!(raw.contains("\"tools\""));
    for tool in ["place_object", "move_object", "delete_object", "rotate_object", "edit_object_property", "generate_image"] {
        assert!(raw.contains(&format!("\"name\":\"{tool}\"")), "missing {tool}");
    }
    assert!(raw.contains("\"tool_choice\":\"auto\""));
}

#[tokio::test]
async fn completion_reports_server_errors() {
    let (port, _seen) = run_server(|_| (401, r#"{"error":"bad key"}"#.into()));
    let error = chat::complete(&completion_config(port), simple_request())
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("401"), "{error}");
    assert!(error.contains("bad key"), "{error}");
}

#[tokio::test]
async fn completion_requires_a_configured_model() {
    let config = CompletionSettings {
        base_url: "http://127.0.0.1:1".into(),
        api_key: String::new(),
        model: "   ".into(),
    };
    let error = chat::complete(&config, simple_request())
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("not configured"), "{error}");
}
