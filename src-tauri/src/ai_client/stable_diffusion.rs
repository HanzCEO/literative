//! Stable Diffusion style API preset (AUTOMATIC1111).
//!
//! With reference images the client uses `/sdapi/v1/img2img`.
//! Without references it uses `/sdapi/v1/txt2img`.

use serde::{Deserialize, Serialize};

use super::{decode_base64, finalize_image, http_client, GenerationRequest, GenerationResult};
use crate::image_core::{ImageCoreError, Result};

#[derive(Debug, Serialize)]
struct SdImg2ImgRequest {
    init_images: Vec<String>,
    prompt: String,
    negative_prompt: String,
    steps: u32,
    cfg_scale: f32,
    width: u32,
    height: u32,
    sampler_name: String,
    denoising_strength: f32,
}

#[derive(Debug, Serialize)]
struct SdTxt2ImgRequest {
    prompt: String,
    negative_prompt: String,
    steps: u32,
    cfg_scale: f32,
    width: u32,
    height: u32,
    sampler_name: String,
}

#[derive(Debug, Deserialize)]
struct SdResponse {
    images: Vec<String>,
}

fn endpoint(settings_endpoint: &str, path: &str) -> String {
    format!("{}{}", settings_endpoint.trim_end_matches('/'), path)
}

/// Run a Stable Diffusion style generation.
pub async fn generate(request: &GenerationRequest) -> Result<GenerationResult> {
    let client = http_client()?;
    let settings = &request.settings;

    if request.references.is_empty() {
        let body = SdTxt2ImgRequest {
            prompt: request.prompt.clone(),
            negative_prompt: settings.params.negative_prompt.clone(),
            steps: settings.params.steps,
            cfg_scale: settings.params.cfg_scale,
            width: settings.params.width,
            height: settings.params.height,
            sampler_name: settings.params.sampler.clone(),
        };
        send(&client, request, "/sdapi/v1/txt2img", &body).await
    } else {
        let mut init_images = Vec::with_capacity(request.references.len());
        for reference in &request.references {
            use base64::Engine;
            let bytes = decode_base64(&reference.data_base64)?;
            let png =
                crate::image_core::io::encode_png(&crate::image_core::io::decode(&bytes)?)?;
            init_images.push(base64::engine::general_purpose::STANDARD.encode(png));
        }
        let body = SdImg2ImgRequest {
            init_images,
            prompt: request.prompt.clone(),
            negative_prompt: settings.params.negative_prompt.clone(),
            steps: settings.params.steps,
            cfg_scale: settings.params.cfg_scale,
            width: settings.params.width,
            height: settings.params.height,
            sampler_name: settings.params.sampler.clone(),
            denoising_strength: settings.params.strength,
        };
        send(&client, request, "/sdapi/v1/img2img", &body).await
    }
}

/// Send a request body and extract the first generated image.
async fn send<T: Serialize>(
    client: &reqwest::Client,
    request: &GenerationRequest,
    path: &str,
    body: &T,
) -> Result<GenerationResult> {
    let settings = &request.settings;
    let response = client
        .post(endpoint(&settings.endpoint, path))
        .json(body)
        .send()
        .await
        .map_err(|err| ImageCoreError::Message(format!("request failed: {err}")))?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(ImageCoreError::Message(format!(
            "image API returned {status}: {text}"
        )));
    }
    let payload: SdResponse = response
        .json()
        .await
        .map_err(|err| ImageCoreError::Message(format!("bad response: {err}")))?;

    let image = payload
        .images
        .first()
        .ok_or_else(|| ImageCoreError::Message("no images in response".into()))?;

    // AUTOMATIC1111 returns raw base64 without a data URL header.
    let bytes = decode_base64(image)?;
    finalize_image(bytes)
}
