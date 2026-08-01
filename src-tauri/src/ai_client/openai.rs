//! OpenAI-compatible images API preset.
//!
//! With reference images the client uses multipart `images/edits`.
//! Without references it uses JSON `images/generations`.

use serde::Deserialize;

use super::{decode_base64, finalize_image, http_client, GenerationRequest, GenerationResult};
use crate::image_core::{ImageCoreError, Result};

#[derive(Debug, Deserialize)]
struct OpenAiImagesResponse {
    data: Vec<OpenAiImage>,
}

#[derive(Debug, Deserialize)]
struct OpenAiImage {
    #[serde(rename = "b64_json")]
    b64_json: Option<String>,
    url: Option<String>,
}

fn endpoint(settings_endpoint: &str, path: &str) -> String {
    format!(
        "{}{}",
        settings_endpoint.trim_end_matches('/'),
        path
    )
}

fn with_auth(
    builder: reqwest::RequestBuilder,
    api_key: &str,
) -> reqwest::RequestBuilder {
    if api_key.is_empty() {
        builder
    } else {
        builder.bearer_auth(api_key)
    }
}

/// Run an OpenAI-compatible generation.
pub async fn generate(request: &GenerationRequest) -> Result<GenerationResult> {
    let client = http_client()?;
    if request.references.is_empty() {
        generate_json(&client, request).await
    } else {
        generate_multipart(&client, request).await
    }
}

/// Send a JSON `images/generations` request.
async fn generate_json(
    client: &reqwest::Client,
    request: &GenerationRequest,
) -> Result<GenerationResult> {
    let settings = &request.settings;
    let mut body = serde_json::json!({
        "prompt": request.prompt,
        "n": settings.params.n,
        "size": format!("{}x{}", settings.params.width, settings.params.height),
    });
    if !settings.model.is_empty() {
        body["model"] = serde_json::Value::String(settings.model.clone());
    }

    let response = with_auth(
        client.post(endpoint(&settings.endpoint, "/v1/images/generations")),
        &settings.api_key,
    )
    .json(&body)
    .send()
    .await
    .map_err(|err| ImageCoreError::Message(format!("request failed: {err}")))?;

    let status = response.status();
    if !status.is_success() {
        let text = response
            .text()
            .await
            .unwrap_or_default();
        return Err(ImageCoreError::Message(format!(
            "image API returned {status}: {text}"
        )));
    }
    let payload: OpenAiImagesResponse = response
        .json()
        .await
        .map_err(|err| ImageCoreError::Message(format!("bad response: {err}")))?;

    let image = payload
        .data
        .first()
        .ok_or_else(|| ImageCoreError::Message("no images in response".into()))?;

    let bytes = if let Some(b64) = &image.b64_json {
        decode_base64(b64)?
    } else if let Some(url) = &image.url {
        client
            .get(url)
            .send()
            .await
            .map_err(|err| ImageCoreError::Message(format!("failed to fetch result: {err}")))?
            .bytes()
            .await
            .map_err(|err| ImageCoreError::Message(format!("failed to read result: {err}")))?
            .to_vec()
    } else {
        return Err(ImageCoreError::Message(
            "image response has neither b64_json nor url".into(),
        ));
    };

    finalize_image(bytes)
}

/// Send a multipart `images/edits` request with reference images.
async fn generate_multipart(
    client: &reqwest::Client,
    request: &GenerationRequest,
) -> Result<GenerationResult> {
    let settings = &request.settings;
    let mut form = reqwest::multipart::Form::new()
        .text("prompt", request.prompt.clone())
        .text("n", settings.params.n.to_string())
        .text("size", format!("{}x{}", settings.params.width, settings.params.height));

    for reference in &request.references {
        let bytes = decode_base64(&reference.data_base64)?;
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name(reference.name.clone())
            .mime_str(&reference.mime_type)
            .map_err(|err| {
                ImageCoreError::Message(format!("bad mime type: {err}"))
            })?;
        form = form.part("image", part);
    }

    let response = with_auth(
        client.post(endpoint(&settings.endpoint, "/v1/images/edits")),
        &settings.api_key,
    )
    .multipart(form)
    .send()
    .await
    .map_err(|err| ImageCoreError::Message(format!("request failed: {err}")))?;

    let status = response.status();
    if !status.is_success() {
        let text = response
            .text()
            .await
            .unwrap_or_default();
        return Err(ImageCoreError::Message(format!(
            "image API returned {status}: {text}"
        )));
    }
    let payload: OpenAiImagesResponse = response
        .json()
        .await
        .map_err(|err| ImageCoreError::Message(format!("bad response: {err}")))?;

    let image = payload
        .data
        .first()
        .ok_or_else(|| ImageCoreError::Message("no images in response".into()))?;

    let bytes = if let Some(b64) = &image.b64_json {
        decode_base64(b64)?
    } else if let Some(url) = &image.url {
        client
            .get(url)
            .send()
            .await
            .map_err(|err| ImageCoreError::Message(format!("failed to fetch result: {err}")))?
            .bytes()
            .await
            .map_err(|err| ImageCoreError::Message(format!("failed to read result: {err}")))?
            .to_vec()
    } else {
        return Err(ImageCoreError::Message(
            "image response has neither b64_json nor url".into(),
        ));
    };

    finalize_image(bytes)
}
