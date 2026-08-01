//! High-speed image resizing with `fast_image_resize`.

use fast_image_resize as fir;
use image::{DynamicImage, RgbaImage};

use super::Result;

/// Resize an image to the exact target dimensions.
///
/// The operation uses the Lanczos3 filter and considers the alpha channel.
pub fn resize(img: &DynamicImage, width: u32, height: u32) -> Result<DynamicImage> {
    let width = width.max(1);
    let height = height.max(1);
    let src = img.to_rgba8();
    let mut dst = RgbaImage::new(width, height);
    let mut resizer = fir::Resizer::new();
    let options = fir::ResizeOptions::new()
        .resize_alg(fir::ResizeAlg::Convolution(fir::FilterType::Lanczos3));
    resizer.resize(&src, &mut dst, &options)?;
    Ok(DynamicImage::ImageRgba8(dst))
}

/// Resize an image to fit within a bounding box while preserving the aspect ratio.
pub fn resize_fit(img: &DynamicImage, max_width: u32, max_height: u32) -> Result<DynamicImage> {
    let (w, h) = fit_dimensions(img.width(), img.height(), max_width, max_height);
    if w == img.width() && h == img.height() {
        return Ok(img.clone());
    }
    resize(img, w, h)
}

/// Compute the largest dimensions that fit inside the box and keep the aspect ratio.
pub fn fit_dimensions(src_w: u32, src_h: u32, max_w: u32, max_h: u32) -> (u32, u32) {
    if src_w == 0 || src_h == 0 {
        return (1, 1);
    }
    let max_w = max_w.max(1) as f64;
    let max_h = max_h.max(1) as f64;
    let scale = (max_w / src_w as f64).min(max_h / src_h as f64).min(1.0);
    (
        (src_w as f64 * scale).round().max(1.0) as u32,
        (src_h as f64 * scale).round().max(1.0) as u32,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    fn test_image(width: u32, height: u32) -> DynamicImage {
        DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            width,
            height,
            Rgba([10, 20, 30, 255]),
        ))
    }

    #[test]
    fn resizes_to_exact_dimensions() {
        let img = test_image(100, 50);
        let out = resize(&img, 25, 25).unwrap();
        assert_eq!(out.width(), 25);
        assert_eq!(out.height(), 25);
    }

    #[test]
    fn resizes_to_one_pixel_minimum() {
        let img = test_image(100, 50);
        let out = resize(&img, 0, 0).unwrap();
        assert_eq!(out.width(), 1);
        assert_eq!(out.height(), 1);
    }

    #[test]
    fn resize_fit_preserves_aspect_ratio() {
        let img = test_image(200, 100);
        let out = resize_fit(&img, 100, 100).unwrap();
        assert_eq!(out.width(), 100);
        assert_eq!(out.height(), 50);
    }

    #[test]
    fn resize_fit_does_not_upscale() {
        let img = test_image(50, 50);
        let out = resize_fit(&img, 200, 200).unwrap();
        assert_eq!(out.width(), 50);
        assert_eq!(out.height(), 50);
    }

    #[test]
    fn fit_dimensions_handles_zero() {
        assert_eq!(fit_dimensions(0, 0, 10, 10), (1, 1));
        assert_eq!(fit_dimensions(10, 20, 0, 0), (1, 1));
    }
}
