//! Poster export: composite text layers with `ab_glyph` and encode files.
//!
//! The frontend sends the raster composite (background plus image layers,
//! rendered with Canvas 2D) as PNG bytes. This module draws the text
//! layers on top with the bundled DejaVu Sans font, then encodes the
//! final poster as PNG or JPEG.

use ab_glyph::{Font, PxScale, ScaleFont};
use image::{DynamicImage, Rgba, RgbaImage};
use serde::Deserialize;

use crate::image_core::{self, ImageCoreError, Result};

/// A text layer to draw onto the poster.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextLayerPayload {
    pub text: String,
    /// Left edge of the text box.
    pub x: f64,
    /// Top edge of the text box.
    pub y: f64,
    pub font_size: f32,
    /// Hex color, for example "#ff0000" or "#ff0000aa".
    pub color: String,
}

/// Parse a hex color into an RGBA pixel.
///
/// Accepts "#rrggbb" and "#rrggbbaa".
pub fn parse_color(hex: &str) -> Result<Rgba<u8>> {
    let hex = hex.trim().trim_start_matches('#');
    let parse = |label: &str| {
        u32::from_str_radix(hex, 16)
            .map_err(|_| ImageCoreError::Message(format!("invalid color '{label}'")))
    };
    match hex.len() {
        6 => {
            let value = parse(hex)?;
            Ok(Rgba([
                (value >> 16) as u8,
                (value >> 8) as u8,
                value as u8,
                255,
            ]))
        }
        8 => {
            let value = parse(hex)?;
            Ok(Rgba([
                (value >> 24) as u8,
                (value >> 16) as u8,
                (value >> 8) as u8,
                value as u8,
            ]))
        }
        _ => Err(ImageCoreError::Message(format!("invalid color '#{hex}'"))),
    }
}

/// Draw all text layers onto an RGBA image.
///
/// Each layer is drawn with the given top-left position and font size.
/// Multi-line text splits on the newline character.
pub fn draw_text_layers(
    img: &mut RgbaImage,
    layers: &[TextLayerPayload],
) -> Result<()> {
    let font = image_core::text::bundled_font()?;
    for layer in layers {
        if layer.text.trim().is_empty() || layer.font_size <= 0.0 {
            continue;
        }
        let color = parse_color(&layer.color)?;
        let scaled = font.as_scaled(PxScale::from(layer.font_size));
        let ascent = scaled.ascent();
        let line_height = layer.font_size * 1.2;
        let mut pen_y = layer.y as f32;
        for line in layer.text.split('\n') {
            let baseline = pen_y + ascent;
            image_core::text::draw_text(
                img,
                &font,
                line,
                layer.x as i32,
                baseline as i32,
                layer.font_size,
                color,
            );
            pen_y += line_height;
        }
    }
    Ok(())
}

/// Encode a poster as PNG or JPEG bytes.
pub fn encode(data: Vec<u8>, layers: &[TextLayerPayload], format: &str, quality: u8) -> Result<Vec<u8>> {
    let img = image_core::io::decode(&data)?;
    let mut rgba = img.to_rgba8();
    draw_text_layers(&mut rgba, layers)?;
    let finished = DynamicImage::ImageRgba8(rgba);
    match format.to_ascii_lowercase().as_str() {
        "jpeg" | "jpg" => image_core::io::encode_jpeg(&finished, quality),
        _ => image_core::io::encode_png(&finished),
    }
}

/// Write a poster to a file path.
pub fn write_to_file(
    data: Vec<u8>,
    layers: &[TextLayerPayload],
    format: &str,
    quality: u8,
    path: &Path,
) -> Result<()> {
    let bytes = encode(data, layers, format, quality)?;
    std::fs::write(path, bytes).map_err(ImageCoreError::Io)
}

use std::path::Path;

#[cfg(test)]
mod tests {
    use super::*;

    fn white_canvas(width: u32, height: u32) -> RgbaImage {
        RgbaImage::from_pixel(width, height, Rgba([255, 255, 255, 255]))
    }

    fn canvas_png(width: u32, height: u32) -> Vec<u8> {
        image_core::io::encode_png(&DynamicImage::ImageRgba8(white_canvas(width, height)))
            .unwrap()
    }

    fn count_dark_pixels(img: &RgbaImage) -> u32 {
        img.pixels().filter(|p| p.0[0] < 250).count() as u32
    }

    #[test]
    fn parse_color_accepts_hex_forms() {
        assert_eq!(parse_color("#ff0000").unwrap(), Rgba([255, 0, 0, 255]));
        assert_eq!(
            parse_color("#ff000080").unwrap(),
            Rgba([255, 0, 0, 128])
        );
        assert_eq!(parse_color("00ff00").unwrap(), Rgba([0, 255, 0, 255]));
    }

    #[test]
    fn parse_color_rejects_garbage() {
        assert!(parse_color("red").is_err());
        assert!(parse_color("#12345").is_err());
        assert!(parse_color("").is_err());
    }

    #[test]
    fn draws_single_line_text() {
        let mut canvas = white_canvas(200, 100);
        let layers = vec![TextLayerPayload {
            text: "Hello".into(),
            x: 20.0,
            y: 30.0,
            font_size: 32.0,
            color: "#000000".into(),
        }];
        draw_text_layers(&mut canvas, &layers).unwrap();
        assert!(count_dark_pixels(&canvas) > 10);
    }

    #[test]
    fn draws_multi_line_text() {
        let mut canvas = white_canvas(200, 200);
        let layers = vec![TextLayerPayload {
            text: "Line one\nLine two".into(),
            x: 10.0,
            y: 20.0,
            font_size: 24.0,
            color: "#000000".into(),
        }];
        draw_text_layers(&mut canvas, &layers).unwrap();
        assert!(count_dark_pixels(&canvas) > 20);
    }

    #[test]
    fn empty_text_is_skipped() {
        let mut canvas = white_canvas(100, 100);
        let layers = vec![
            TextLayerPayload {
                text: "".into(),
                x: 10.0,
                y: 10.0,
                font_size: 24.0,
                color: "#000000".into(),
            },
            TextLayerPayload {
                text: "   ".into(),
                x: 10.0,
                y: 10.0,
                font_size: 24.0,
                color: "#000000".into(),
            },
        ];
        draw_text_layers(&mut canvas, &layers).unwrap();
        assert_eq!(count_dark_pixels(&canvas), 0);
    }

    #[test]
    fn invalid_color_errors() {
        let mut canvas = white_canvas(100, 100);
        let layers = vec![TextLayerPayload {
            text: "Hi".into(),
            x: 10.0,
            y: 10.0,
            font_size: 24.0,
            color: "nope".into(),
        }];
        assert!(draw_text_layers(&mut canvas, &layers).is_err());
    }

    #[test]
    fn encode_writes_png_with_text() {
        let data = canvas_png(200, 100);
        let layers = vec![TextLayerPayload {
            text: "Poster".into(),
            x: 30.0,
            y: 40.0,
            font_size: 36.0,
            color: "#000000".into(),
        }];
        let png = encode(data, &layers, "png", 90).unwrap();
        assert_eq!(&png[..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
        let decoded = image_core::io::decode(&png).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (200, 100));
    }

    #[test]
    fn encode_writes_jpeg() {
        let data = canvas_png(100, 80);
        let layers = vec![];
        let jpeg = encode(data, &layers, "jpeg", 80).unwrap();
        assert_eq!(&jpeg[..3], &[0xFF, 0xD8, 0xFF]);
    }

    #[test]
    fn write_to_file_creates_file() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("literative-test-{}.png", std::process::id()));
        let data = canvas_png(64, 64);
        write_to_file(data, &[], "png", 90, &path).unwrap();
        assert!(path.exists());
        let bytes = std::fs::read(&path).unwrap();
        assert!(bytes.len() > 0);
        let _ = std::fs::remove_file(&path);
    }
}
