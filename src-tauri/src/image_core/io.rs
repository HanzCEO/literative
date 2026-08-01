//! Decode and encode image files.

use image::{DynamicImage, ImageFormat};

use super::{ImageCoreError, Result};

/// Decode an image from raw file bytes.
pub fn decode(data: &[u8]) -> Result<DynamicImage> {
    image::load_from_memory(data).map_err(ImageCoreError::Image)
}

/// Encode an image as PNG bytes.
pub fn encode_png(img: &DynamicImage) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut out), ImageFormat::Png)
        .map_err(ImageCoreError::Image)?;
    Ok(out)
}

/// Encode an image as JPEG bytes with the given quality.
pub fn encode_jpeg(img: &DynamicImage, quality: u8) -> Result<Vec<u8>> {
    let quality = quality.clamp(1, 100);
    let mut out = Vec::new();
    let mut encoder =
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality);
    let rgb = img.to_rgb8();
    encoder
        .encode(&rgb, rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)
        .map_err(ImageCoreError::Image)?;
    Ok(out)
}

/// Encode an image as a base64 data URL for direct use in the frontend.
pub fn encode_png_data_url(img: &DynamicImage) -> Result<String> {
    use base64::Engine;
    let bytes = encode_png(img)?;
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    fn test_image(width: u32, height: u32) -> DynamicImage {
        DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            width,
            height,
            Rgba([200, 100, 50, 255]),
        ))
    }

    #[test]
    fn decodes_png_bytes() {
        let img = test_image(4, 3);
        let bytes = encode_png(&img).unwrap();
        let decoded = decode(&bytes).unwrap();
        assert_eq!(decoded.width(), 4);
        assert_eq!(decoded.height(), 3);
    }

    #[test]
    fn rejects_garbage_input() {
        assert!(decode(b"not an image at all").is_err());
    }

    #[test]
    fn encodes_png_with_magic_bytes() {
        let img = test_image(2, 2);
        let bytes = encode_png(&img).unwrap();
        assert_eq!(&bytes[..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
    }

    #[test]
    fn encodes_jpeg_with_magic_bytes() {
        let img = test_image(2, 2);
        let bytes = encode_jpeg(&img, 85).unwrap();
        assert_eq!(&bytes[..3], &[0xFF, 0xD8, 0xFF]);
    }

    #[test]
    fn clamps_jpeg_quality() {
        let img = test_image(2, 2);
        assert!(encode_jpeg(&img, 0).is_ok());
        assert!(encode_jpeg(&img, 200).is_ok());
    }

    #[test]
    fn encodes_data_url() {
        let img = test_image(2, 2);
        let url = encode_png_data_url(&img).unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
    }
}
