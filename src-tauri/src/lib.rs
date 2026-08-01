pub mod ai_client;
pub mod image_core;
pub mod settings;

use ai_client::ReferencePayload;
use image_core::{ImageCoreError, Result};
use tauri::Manager;

/// Decode image bytes and return a downscaled PNG preview as a data URL.
///
/// The preview is at most 1024 pixels on its longest side.
#[tauri::command]
fn image_preview(data: Vec<u8>) -> Result<String> {
    let img = image_core::io::decode(&data)?;
    let preview = image_core::resize::resize_fit(&img, 1024, 1024)?;
    image_core::io::encode_png_data_url(&preview)
}

/// Resize image bytes to exact dimensions and return PNG data.
#[tauri::command]
fn image_resize(data: Vec<u8>, width: u32, height: u32) -> Result<Vec<u8>> {
    let img = image_core::io::decode(&data)?;
    let out = image_core::resize::resize(&img, width, height)?;
    image_core::io::encode_png(&out)
}

/// Apply a filter to image bytes and return PNG data.
#[tauri::command]
fn image_apply_filter(data: Vec<u8>, filter: image_core::FilterKind) -> Result<Vec<u8>> {
    let img = image_core::io::decode(&data)?;
    let out = image_core::filters::apply_filter(&img, &filter)?;
    image_core::io::encode_png(&out)
}

/// Export image bytes as PNG and return a data URL.
#[tauri::command]
fn image_export_png(data: Vec<u8>) -> Result<String> {
    let img = image_core::io::decode(&data)?;
    image_core::io::encode_png_data_url(&img)
}

/// Export image bytes as JPEG with the given quality and return a data URL.
#[tauri::command]
fn image_export_jpeg(data: Vec<u8>, quality: u8) -> Result<String> {
    let img = image_core::io::decode(&data)?;
    let bytes = image_core::io::encode_jpeg(&img, quality)?;
    use base64::Engine;
    Ok(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// Return image metadata for the given bytes.
#[tauri::command]
fn image_metadata(data: Vec<u8>) -> Result<serde_json::Value> {
    let img = image_core::io::decode(&data)?;
    Ok(serde_json::json!({
        "width": img.width(),
        "height": img.height(),
    }))
}

/// Load settings from the platform config directory, or return defaults.
fn load_settings(app: &tauri::AppHandle) -> Result<settings::AppSettings> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| ImageCoreError::Message(err.to_string()))?;
    let path = dir.join("settings.json");
    if path.exists() {
        settings::AppSettings::load(&path).map_err(ImageCoreError::Message)
    } else {
        Ok(settings::AppSettings::default())
    }
}

/// Generate a poster from a prompt and optional reference images.
#[tauri::command]
async fn generate_poster(
    app: tauri::AppHandle,
    prompt: String,
    references: Vec<ReferencePayload>,
) -> Result<ai_client::GenerationResult> {
    let settings = load_settings(&app)?;
    let request = ai_client::GenerationRequest {
        settings,
        prompt,
        references,
    };
    ai_client::generate(request).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            image_preview,
            image_resize,
            image_apply_filter,
            image_export_png,
            image_export_jpeg,
            image_metadata,
            generate_poster,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, Rgba};

    fn png_bytes() -> Vec<u8> {
        let img = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            200,
            100,
            Rgba([10, 200, 30, 255]),
        ));
        image_core::io::encode_png(&img).unwrap()
    }

    #[test]
    fn preview_command_returns_data_url() {
        let url = image_preview(png_bytes()).unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn filter_command_returns_png() {
        let out = image_apply_filter(png_bytes(), image_core::FilterKind::Grayscale).unwrap();
        assert_eq!(&out[..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
    }

    #[test]
    fn export_jpeg_command_returns_data_url() {
        let url = image_export_jpeg(png_bytes(), 80).unwrap();
        assert!(url.starts_with("data:image/jpeg;base64,"));
    }

    #[test]
    fn metadata_command_returns_dimensions() {
        let meta = image_metadata(png_bytes()).unwrap();
        assert_eq!(meta["width"], 200);
        assert_eq!(meta["height"], 100);
    }
}
