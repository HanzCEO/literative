//! Photographic filters and effects backed by `photon-rs`.

use image::{DynamicImage, RgbaImage};
use photon_rs::PhotonImage;

use super::{FilterKind, ImageCoreError, Result};

/// Convert an `image` image into a photon-rs image.
pub fn to_photon(img: &DynamicImage) -> PhotonImage {
    let rgba = img.to_rgba8();
    PhotonImage::new(rgba.into_raw(), img.width(), img.height())
}

/// Convert a photon-rs image into an `image` image.
pub fn from_photon(img: &PhotonImage) -> Result<DynamicImage> {
    let rgba = RgbaImage::from_raw(
        img.get_width(),
        img.get_height(),
        img.get_raw_pixels(),
    )
    .ok_or_else(|| ImageCoreError::Message("photon buffer size mismatch".into()))?;
    Ok(DynamicImage::ImageRgba8(rgba))
}

/// Parse a hex color string such as "#ff8800" into an (r, g, b) tuple.
fn parse_hex_color(hex: &str) -> Result<(u8, u8, u8)> {
    let hex = hex.trim().trim_start_matches('#');
    if hex.len() != 6 {
        return Err(ImageCoreError::Message(format!(
            "invalid hex color '{hex}'"
        )));
    }
    let value = u32::from_str_radix(hex, 16).map_err(|_| {
        ImageCoreError::Message(format!("invalid hex color '#{hex}'"))
    })?;
    Ok((
        (value >> 16) as u8,
        (value >> 8) as u8,
        value as u8,
    ))
}

/// Apply a filter to an image.
pub fn apply_filter(img: &DynamicImage, kind: &FilterKind) -> Result<DynamicImage> {
    let mut photon = to_photon(img);
    match kind {
        FilterKind::Grayscale => photon_rs::monochrome::grayscale(&mut photon),
        FilterKind::Sepia => photon_rs::monochrome::sepia(&mut photon),
        FilterKind::Invert => invert(&mut photon),
        FilterKind::Desaturate => photon_rs::monochrome::desaturate(&mut photon),
        FilterKind::Blur(radius) => {
            photon_rs::conv::gaussian_blur(&mut photon, (*radius).max(0.0) as i32)
        }
        FilterKind::Sharpen => photon_rs::conv::sharpen(&mut photon),
        FilterKind::EdgeDetection => photon_rs::conv::edge_detection(&mut photon),
        FilterKind::Brightness(value) => {
            let value = (*value).clamp(-255, 255) as i16;
            photon_rs::effects::adjust_brightness(&mut photon, value)
        }
        FilterKind::Contrast(value) => {
            let value = if *value == 0.0 { 1.0 } else { *value };
            photon_rs::effects::adjust_contrast(&mut photon, value)
        }
        FilterKind::Solarize => photon_rs::effects::solarize(&mut photon),
        FilterKind::Threshold(value) => {
            photon_rs::monochrome::threshold(&mut photon, *value)
        }
        FilterKind::Pixelize(value) => {
            photon_rs::effects::pixelize(&mut photon, (*value).max(1))
        }
        FilterKind::Oil(radius, intensity) => {
            photon_rs::effects::oil(&mut photon, *radius, *intensity)
        }
        FilterKind::FrostedGlass => photon_rs::effects::frosted_glass(&mut photon),
        FilterKind::Duotone(color_a, color_b) => {
            let (ra, ga, ba) = parse_hex_color(color_a)?;
            let (rb, gb, bb) = parse_hex_color(color_b)?;
            photon_rs::effects::duotone(
                &mut photon,
                photon_rs::Rgb::new(ra, ga, ba),
                photon_rs::Rgb::new(rb, gb, bb),
            );
        }
        FilterKind::Named(name) => photon_rs::filters::filter(&mut photon, name),
    }
    from_photon(&photon)
}

/// Invert all channels of a photon image.
fn invert(photon: &mut PhotonImage) {
    let pixels = photon.get_raw_pixels();
    let inverted: Vec<u8> = pixels
        .chunks_exact(4)
        .flat_map(|p| [255 - p[0], 255 - p[1], 255 - p[2], p[3]])
        .collect();
    *photon = PhotonImage::new(inverted, photon.get_width(), photon.get_height());
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    fn solid_image(color: Rgba<u8>) -> DynamicImage {
        DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(4, 4, color))
    }

    fn center_pixel(img: &DynamicImage) -> [u8; 4] {
        let rgba = img.to_rgba8();
        rgba.get_pixel(2, 2).0
    }

    #[test]
    fn grayscale_keeps_dimensions() {
        let img = solid_image(Rgba([100, 150, 200, 255]));
        let out = apply_filter(&img, &FilterKind::Grayscale).unwrap();
        assert_eq!(out.width(), 4);
        assert_eq!(out.height(), 4);
        let px = center_pixel(&out);
        assert_eq!(px[0], px[1]);
        assert_eq!(px[1], px[2]);
        assert_eq!(px[3], 255);
    }

    #[test]
    fn sepia_warms_the_pixels() {
        let img = solid_image(Rgba([50, 50, 50, 255]));
        let out = apply_filter(&img, &FilterKind::Sepia).unwrap();
        let px = center_pixel(&out);
        assert!(px[0] > px[2], "red channel should exceed blue");
    }

    #[test]
    fn invert_flips_channels() {
        let img = solid_image(Rgba([10, 20, 30, 255]));
        let out = apply_filter(&img, &FilterKind::Invert).unwrap();
        let px = center_pixel(&out);
        assert_eq!([px[0], px[1], px[2]], [245, 235, 225]);
        assert_eq!(px[3], 255);
    }

    #[test]
    fn brightness_makes_image_whiter() {
        let img = solid_image(Rgba([50, 50, 50, 255]));
        let out = apply_filter(&img, &FilterKind::Brightness(100)).unwrap();
        let px = center_pixel(&out);
        assert!(px[0] > 50);
    }

    #[test]
    fn blur_keeps_dimensions() {
        let img = solid_image(Rgba([10, 200, 30, 255]));
        let out = apply_filter(&img, &FilterKind::Blur(3.0)).unwrap();
        assert_eq!(out.width(), 4);
        assert_eq!(out.height(), 4);
    }

    #[test]
    fn duotone_parses_hex_colors() {
        // White luminance maps to the end of the gradient, which is color_b.
        let img = solid_image(Rgba([255, 255, 255, 255]));
        let out = apply_filter(
            &img,
            &FilterKind::Duotone("#ff0000".into(), "#0000ff".into()),
        )
        .unwrap();
        let px = center_pixel(&out);
        assert!(px[2] >= 254, "white should map to color_b (blue), got {}", px[2]);

        // Black luminance maps to the start of the gradient, which is color_a.
        let img = solid_image(Rgba([0, 0, 0, 255]));
        let out = apply_filter(
            &img,
            &FilterKind::Duotone("#ff0000".into(), "#0000ff".into()),
        )
        .unwrap();
        let px = center_pixel(&out);
        assert_eq!(px[0], 255, "black should map to color_a (red)");
    }

    #[test]
    fn duotone_rejects_bad_hex() {
        let img = solid_image(Rgba([255, 255, 255, 255]));
        assert!(apply_filter(&img, &FilterKind::Duotone("red".into(), "#0000ff".into())).is_err());
    }

    #[test]
    fn named_filter_applies() {
        let img = solid_image(Rgba([128, 128, 128, 255]));
        let out = apply_filter(&img, &FilterKind::Named("lofi".into())).unwrap();
        assert_eq!(out.width(), 4);
    }

    #[test]
    fn parse_hex_color_accepts_and_rejects() {
        assert_eq!(parse_hex_color("#a1b2c3").unwrap(), (0xa1, 0xb2, 0xc3));
        assert!(parse_hex_color("xyz").is_err());
        assert!(parse_hex_color("#12345").is_err());
    }
}
