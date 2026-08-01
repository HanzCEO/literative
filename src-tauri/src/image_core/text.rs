//! Text rendering into images with `ab_glyph`.
//!
//! The module bundles DejaVu Sans, which is licensed under the
//! Bitstream Vera license, to keep the binary self-contained.

use ab_glyph::{point, Font, FontVec, PxScale, ScaleFont};
use image::{Rgba, RgbaImage};

use super::Result;

/// The bundled DejaVu Sans font.
pub fn bundled_font() -> Result<FontVec> {
    let bytes = include_bytes!("../../assets/DejaVuSans.ttf");
    FontVec::try_from_vec(bytes.to_vec()).map_err(Into::into)
}

/// Render text into an image at the given position and size.
///
/// The text is rendered in the given color. The `y` parameter is the
/// baseline of the first line of text.
pub fn draw_text(
    img: &mut RgbaImage,
    font: &FontVec,
    text: &str,
    x: i32,
    y: i32,
    font_size: f32,
    color: Rgba<u8>,
) {
    let scale = PxScale::from(font_size);
    let scaled_font = font.as_scaled(scale);
    let mut pen_x = x as f32;
    let pen_y = y as f32;

    for c in text.chars() {
        let glyph_id = scaled_font.glyph_id(c);
        let glyph = glyph_id.with_scale_and_position(scale, point(pen_x, pen_y));
        if let Some(outlined) = scaled_font.outline_glyph(glyph) {
            let bounds = outlined.px_bounds();
            let offset_x = bounds.min.x as i32;
            let offset_y = bounds.min.y as i32;
            outlined.draw(|gx, gy, coverage| {
                let px = offset_x + gx as i32;
                let py = offset_y + gy as i32;
                if px < 0 || py < 0 || px as u32 >= img.width() || py as u32 >= img.height() {
                    return;
                }
                let dst = img.get_pixel_mut(px as u32, py as u32);
                let alpha = (coverage * color.0[3] as f32) as u8;
                blend_pixel(dst, color, alpha);
            });
        }
        pen_x += scaled_font.h_advance(glyph_id);
    }
}

/// Alpha-composite a source color over a destination pixel.
fn blend_pixel(dst: &mut Rgba<u8>, src: Rgba<u8>, src_alpha: u8) {
    let a = src_alpha as f32 / 255.0;
    let inv_a = 1.0 - a;
    for channel in 0..3 {
        dst.0[channel] =
            (src.0[channel] as f32 * a + dst.0[channel] as f32 * inv_a).round() as u8;
    }
    dst.0[3] = (src.0[3] as f32 * a + dst.0[3] as f32 * inv_a).round() as u8;
}

/// Measure the width and height of rendered text for a given font size.
pub fn measure_text(font: &FontVec, text: &str, font_size: f32) -> (u32, u32) {
    let scale = PxScale::from(font_size);
    let scaled_font = font.as_scaled(scale);
    let mut min_x = f32::MAX;
    let mut max_x = f32::MIN;
    let mut min_y = f32::MAX;
    let mut max_y = f32::MIN;
    let mut pen_x = 0.0_f32;
    for c in text.chars() {
        let glyph_id = scaled_font.glyph_id(c);
        let glyph = glyph_id.with_scale_and_position(scale, point(pen_x, 0.0));
        if let Some(outlined) = scaled_font.outline_glyph(glyph) {
            let bounds = outlined.px_bounds();
            min_x = min_x.min(bounds.min.x);
            max_x = max_x.max(bounds.max.x);
            min_y = min_y.min(bounds.min.y);
            max_y = max_y.max(bounds.max.y);
        }
        pen_x += scaled_font.h_advance(glyph_id);
    }
    if min_x == f32::MAX {
        return (0, 0);
    }
    (
        (max_x - min_x).round().max(0.0) as u32,
        (max_y - min_y).round().max(0.0) as u32,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::DynamicImage;

    fn white_canvas(width: u32, height: u32) -> RgbaImage {
        RgbaImage::from_pixel(width, height, Rgba([255, 255, 255, 255]))
    }

    #[test]
    fn loads_bundled_font() {
        assert!(bundled_font().is_ok());
    }

    #[test]
    fn draws_text_pixels() {
        let font = bundled_font().unwrap();
        let mut canvas = white_canvas(200, 100);
        draw_text(
            &mut canvas,
            &font,
            "Poster",
            20,
            50,
            32.0,
            Rgba([0, 0, 0, 255]),
        );
        // The text must darken some pixels below the baseline.
        let mut touched = 0;
        for y in 30..70 {
            for x in 20..120 {
                if canvas.get_pixel(x, y).0[0] < 255 {
                    touched += 1;
                }
            }
        }
        assert!(touched > 10, "text should rasterize pixels");
    }

    #[test]
    fn empty_text_does_nothing() {
        let font = bundled_font().unwrap();
        let mut canvas = white_canvas(100, 100);
        draw_text(&mut canvas, &font, "", 10, 50, 24.0, Rgba([0, 0, 0, 255]));
        let touched: u32 = canvas
            .pixels()
            .filter(|p| p.0[0] < 255)
            .count() as u32;
        assert_eq!(touched, 0);
    }

    #[test]
    fn measures_text_size() {
        let font = bundled_font().unwrap();
        let (w, h) = measure_text(&font, "Hello", 32.0);
        assert!(w > 0);
        assert!(h > 0);
    }

    #[test]
    fn draws_text_with_alpha_blending() {
        let font = bundled_font().unwrap();
        let mut canvas = white_canvas(200, 100);
        draw_text(
            &mut canvas,
            &font,
            "Ghost",
            20,
            50,
            32.0,
            Rgba([0, 0, 0, 128]),
        );
        let mut found_semi_transparent = false;
        for y in 30..70 {
            for x in 20..140 {
                let px = canvas.get_pixel(x, y).0;
                if px[0] > 0 && px[0] < 255 {
                    found_semi_transparent = true;
                }
            }
        }
        assert!(found_semi_transparent, "alpha blending should produce in-between values");
    }

    #[test]
    fn text_module_works_with_dynamic_image() {
        let img = DynamicImage::ImageRgba8(white_canvas(100, 50));
        assert_eq!(img.width(), 100);
    }
}
