pub mod ai_client;
pub mod image_core;
pub mod poster;
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

/// Resolve the settings file path in the platform config directory.
fn settings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| ImageCoreError::Message(err.to_string()))?;
    Ok(dir.join("settings.json"))
}

/// Load settings from the platform config directory.
///
/// Returns None when no settings file exists yet.
fn load_settings(app: &tauri::AppHandle) -> Result<Option<settings::AppSettings>> {
    let path = settings_path(app)?;
    if path.exists() {
        settings::AppSettings::load(&path)
            .map(Some)
            .map_err(ImageCoreError::Message)
    } else {
        Ok(None)
    }
}

/// Return the persisted settings, or None on first run.
#[tauri::command]
fn get_app_settings(app: tauri::AppHandle) -> Result<Option<settings::AppSettings>> {
    load_settings(&app)
}

/// Persist the settings to the platform config directory.
#[tauri::command]
fn save_app_settings(
    app: tauri::AppHandle,
    settings: settings::AppSettings,
) -> Result<settings::AppSettings> {
    let path = settings_path(&app)?;
    settings.save(&path).map_err(ImageCoreError::Message)?;
    Ok(settings)
}

/// Read image files from the filesystem and return them as reference payloads.
#[tauri::command]
fn read_reference_images(paths: Vec<String>) -> Result<Vec<ai_client::ReferencePayload>> {
    use base64::Engine;

    paths
        .into_iter()
        .map(|path| {
            let bytes = std::fs::read(&path).map_err(|err| {
                ImageCoreError::Message(format!("failed to read {path}: {err}"))
            })?;
            let mime = match image::guess_format(&bytes) {
                Ok(image::ImageFormat::Png) => "image/png",
                Ok(image::ImageFormat::Jpeg) => "image/jpeg",
                Ok(image::ImageFormat::Gif) => "image/gif",
                Ok(image::ImageFormat::WebP) => "image/webp",
                Ok(image::ImageFormat::Bmp) => "image/bmp",
                Ok(image::ImageFormat::Avif) => "image/avif",
                _ => "image/png",
            };
            let name = std::path::Path::new(&path)
                .file_name()
                .map(|part| part.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.clone());
            Ok(ai_client::ReferencePayload {
                name,
                mime_type: mime.into(),
                data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
            })
        })
        .collect()
}

/// Generate a poster from a prompt, reference images, and project params.
#[tauri::command]
async fn generate_poster(
    app: tauri::AppHandle,
    prompt: String,
    references: Vec<ReferencePayload>,
    params: settings::GenerationParams,
) -> Result<ai_client::GenerationResult> {
    let mut settings = load_settings(&app)?.unwrap_or_default();
    settings.params = params;
    let request = ai_client::GenerationRequest {
        settings,
        prompt,
        references,
    };
    ai_client::generate(request).await
}

/// Export the final poster to a file chosen by the user.
///
/// The `data` argument is the raster composite as PNG bytes. The text
/// layers are drawn on top with the bundled font, then the result is
/// written to `path` as PNG or JPEG.
#[tauri::command]
fn export_poster_to_file(
    data: Vec<u8>,
    text_layers: Vec<poster::TextLayerPayload>,
    format: String,
    quality: u8,
    path: String,
) -> Result<String> {
    poster::write_to_file(data, &text_layers, &format, quality, std::path::Path::new(&path))?;
    Ok(path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            image_preview,
            image_resize,
            image_apply_filter,
            image_export_png,
            image_export_jpeg,
            image_metadata,
            generate_poster,
            read_reference_images,
            export_poster_to_file,
            get_app_settings,
            save_app_settings,
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
