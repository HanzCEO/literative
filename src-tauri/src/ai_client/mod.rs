//! AI image generation client.
//!
//! The client talks to a user-configured endpoint using one of two
//! request schemas: an OpenAI-compatible images API, or a Stable
//! Diffusion style API (AUTOMATIC1111).

pub mod openai;
pub mod stable_diffusion;

use serde::{Deserialize, Serialize};

use crate::image_core::{self, ImageCoreError, Result};
use crate::settings::{AppSettings, PresetKind};

/// A reference image sent with the prompt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferencePayload {
    pub name: String,
    pub mime_type: String,
    pub data_base64: String,
}

/// A full generation request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationRequest {
    pub settings: AppSettings,
    pub prompt: String,
    pub references: Vec<ReferencePayload>,
}

/// The generated poster returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationResult {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
}

/// Build an HTTP client with a generous timeout for slow servers.
pub fn http_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|err| ImageCoreError::Message(format!("http client: {err}")))
}

/// Normalize raw image bytes into a PNG data URL with dimensions.
pub fn finalize_image(bytes: Vec<u8>) -> Result<GenerationResult> {
    let img = image_core::io::decode(&bytes)?;
    Ok(GenerationResult {
        data_url: image_core::io::encode_png_data_url(&img)?,
        width: img.width(),
        height: img.height(),
    })
}

/// Decode a base64 string into raw bytes.
pub fn decode_base64(data: &str) -> Result<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|err| ImageCoreError::Message(format!("invalid base64: {err}")))
}

/// Run a generation against the configured endpoint.
pub async fn generate(request: GenerationRequest) -> Result<GenerationResult> {
    match request.settings.preset {
        PresetKind::OpenAiCompatible => openai::generate(&request).await,
        PresetKind::StableDiffusion => stable_diffusion::generate(&request).await,
    }
}
