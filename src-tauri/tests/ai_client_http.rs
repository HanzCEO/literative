//! HTTP integration tests for the AI generation client.
//!
//! Each test starts a minimal TCP server that records the request and
//! responds with a canned JSON body, then asserts on the client result.

use literative_lib::ai_client::{self, GenerationRequest, ReferencePayload};
use literative_lib::settings::{AppSettings, PresetKind};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;

fn base64_png() -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(base64_png_bytes())
}

fn base64_png_bytes() -> Vec<u8> {
    let img = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
        2,
        2,
        image::Rgba([10, 200, 30, 255]),
    ));
    literative_lib::image_core::io::encode_png(&img).unwrap()
}

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

fn default_request(port: u16, preset: PresetKind) -> GenerationRequest {
    let mut settings = AppSettings::default();
    settings.preset = preset;
    settings.endpoint = format!("http://127.0.0.1:{port}");
    GenerationRequest {
        settings,
        prompt: "a concert poster".into(),
        references: vec![],
    }
}

#[tokio::test]
async fn openai_generations_uses_json_endpoint() {
    let png = base64_png();
    let server_png = png.clone();
    let (port, seen) =
        run_server(move |_| (200, format!(r#"{{"data":[{{"b64_json":"{server_png}"}}]}}"#)));
    let result = ai_client::generate(default_request(port, PresetKind::OpenAiCompatible))
        .await
        .unwrap();
    assert!(result.data_url.starts_with("data:image/png;base64,"));
    assert_eq!((result.width, result.height), (2, 2));
    let request = seen.lock().unwrap().clone().unwrap();
    assert!(request.contains("/v1/images/generations"));
    assert!(request.contains("\"prompt\""));
    assert!(request.contains("a concert poster"));
}

#[tokio::test]
async fn openai_edits_uses_multipart_with_references() {
    let png = base64_png();
    let server_png = png.clone();
    let (port, seen) =
        run_server(move |_| (200, format!(r#"{{"data":[{{"b64_json":"{server_png}"}}]}}"#)));
    let mut request = default_request(port, PresetKind::OpenAiCompatible);
    request.references = vec![ReferencePayload {
        name: "mood.png".into(),
        mime_type: "image/png".into(),
        data_base64: png.clone(),
    }];
    let result = ai_client::generate(request).await.unwrap();
    assert!(result.data_url.starts_with("data:image/png;base64,"));
    let request = seen.lock().unwrap().clone().unwrap();
    assert!(request.contains("/v1/images/edits"));
    assert!(request.contains("name=\"image\""));
    assert!(request.contains("filename=\"mood.png\""));
    assert!(request.contains("Content-Type: image/png"));
}

#[tokio::test]
async fn openai_url_result_is_fetched() {
    let png_bytes = base64_png_bytes();

    // Image server that serves the generated PNG bytes.
    let image_listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let image_port = image_listener.local_addr().unwrap().port();
    let image_url = format!("http://127.0.0.1:{image_port}/image.png");
    thread::spawn(move || {
        let (mut stream, _) = image_listener.accept().unwrap();
        let _ = read_full_request(&mut stream);
        let headers = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            png_bytes.len()
        );
        let _ = stream.write_all(headers.as_bytes());
        let _ = stream.write_all(&png_bytes);
    });

    // API server that returns a URL pointing at the image server.
    let (port, _seen) = run_server(move |_| {
        (200, format!(r#"{{"data":[{{"url":"{image_url}"}}]}}"#))
    });

    let result = ai_client::generate(default_request(port, PresetKind::OpenAiCompatible))
        .await
        .unwrap();
    assert!(result.data_url.starts_with("data:image/png;base64,"));
}

#[tokio::test]
async fn stable_diffusion_txt2img_uses_json_endpoint() {
    let png = base64_png();
    let (port, seen) = run_server(move |_| (200, format!(r#"{{"images":["{png}"]}}"#)));
    let result = ai_client::generate(default_request(port, PresetKind::StableDiffusion))
        .await
        .unwrap();
    assert!(result.data_url.starts_with("data:image/png;base64,"));
    let request = seen.lock().unwrap().clone().unwrap();
    assert!(request.contains("/sdapi/v1/txt2img"));
    assert!(request.contains("\"sampler_name\""));
    assert!(request.contains("\"steps\""));
}

#[tokio::test]
async fn stable_diffusion_img2img_sends_init_images() {
    let png = base64_png();
    let server_png = png.clone();
    let (port, seen) = run_server(move |_| (200, format!(r#"{{"images":["{server_png}"]}}"#)));
    let mut request = default_request(port, PresetKind::StableDiffusion);
    request.references = vec![ReferencePayload {
        name: "mood.png".into(),
        mime_type: "image/png".into(),
        data_base64: png.clone(),
    }];
    let result = ai_client::generate(request).await.unwrap();
    assert!(result.data_url.starts_with("data:image/png;base64,"));
    let request = seen.lock().unwrap().clone().unwrap();
    assert!(request.contains("/sdapi/v1/img2img"));
    assert!(request.contains("\"init_images\""));
    assert!(request.contains("\"denoising_strength\""));
}

#[tokio::test]
async fn server_error_is_propagated() {
    let (port, _seen) = run_server(|_| (500, r#"{"error":"boom"}"#.into()));
    let result = ai_client::generate(default_request(port, PresetKind::OpenAiCompatible))
        .await;
    let err = result.unwrap_err();
    assert!(err.to_string().contains("500"), "unexpected error: {err}");
}

#[tokio::test]
async fn empty_image_list_is_an_error() {
    let (port, _seen) = run_server(|_| (200, r#"{"data":[]}"#.into()));
    let result = ai_client::generate(default_request(port, PresetKind::OpenAiCompatible))
        .await;
    assert!(result.is_err());
}

#[tokio::test]
async fn connection_refused_is_an_error() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let result = ai_client::generate(default_request(port, PresetKind::OpenAiCompatible))
        .await;
    assert!(result.is_err());
}
