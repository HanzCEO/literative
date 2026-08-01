//! Core image processing operations for the poster editor.
//!
//! The module uses these crates:
//! - `image` for decode, encode, and core operations.
//! - `photon-rs` for photographic filters and effects.
//! - `fast_image_resize` for high-speed resizing.
//! - `ab_glyph` for text rendering.

pub mod filters;
pub mod io;
pub mod resize;
pub mod text;

use std::fmt;

/// Errors that the image core can produce.
#[derive(Debug)]
pub enum ImageCoreError {    Image(image::ImageError),
    Resize(fast_image_resize::ResizeError),
    Io(std::io::Error),
    Font(ab_glyph::InvalidFont),
    Message(String),
}

impl fmt::Display for ImageCoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ImageCoreError::Image(err) => write!(f, "image error: {err}"),
            ImageCoreError::Resize(err) => write!(f, "resize error: {err}"),
            ImageCoreError::Io(err) => write!(f, "io error: {err}"),
            ImageCoreError::Font(err) => write!(f, "font error: {err}"),
            ImageCoreError::Message(msg) => write!(f, "{msg}"),
        }
    }
}

impl std::error::Error for ImageCoreError {}

impl From<image::ImageError> for ImageCoreError {
    fn from(err: image::ImageError) -> Self {
        ImageCoreError::Image(err)
    }
}

impl From<fast_image_resize::ResizeError> for ImageCoreError {
    fn from(err: fast_image_resize::ResizeError) -> Self {
        ImageCoreError::Resize(err)
    }
}

impl From<std::io::Error> for ImageCoreError {
    fn from(err: std::io::Error) -> Self {
        ImageCoreError::Io(err)
    }
}

impl From<ab_glyph::InvalidFont> for ImageCoreError {
    fn from(err: ab_glyph::InvalidFont) -> Self {
        ImageCoreError::Font(err)
    }
}

impl From<String> for ImageCoreError {
    fn from(msg: String) -> Self {
        ImageCoreError::Message(msg)
    }
}

impl From<ImageCoreError> for tauri::ipc::InvokeError {
    fn from(err: ImageCoreError) -> Self {
        tauri::ipc::InvokeError::from_error(err)
    }
}

pub type Result<T> = std::result::Result<T, ImageCoreError>;

/// The set of photographic filters and effects that the core supports.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterKind {
    /// Convert the image to grayscale.
    Grayscale,
    /// Apply a sepia tone.
    Sepia,
    /// Invert all channel values.
    Invert,
    /// Remove color saturation.
    Desaturate,
    /// Gaussian blur with a sigma radius.
    Blur(f32),
    /// Convolution sharpen.
    Sharpen,
    /// Sobel edge detection.
    EdgeDetection,
    /// Adjust brightness in the range -255 to 255.
    Brightness(i32),
    /// Adjust contrast as a multiplier around 1.0.
    Contrast(f32),
    /// Solarize the image.
    Solarize,
    /// Apply a binary threshold.
    Threshold(u32),
    /// Pixelate with the given pixel size.
    Pixelize(i32),
    /// Oil paint effect with radius and intensity.
    Oil(i32, f64),
    /// Frosted glass blur.
    FrostedGlass,
    /// Duotone effect from two hex colors, for example "#ff0000".
    Duotone(String, String),
    /// A named photon-rs filter preset.
    Named(String),
}
