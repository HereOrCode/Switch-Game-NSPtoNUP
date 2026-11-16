//! 16:9 covers: downloaded automatically by Title ID, or supplied by the player (auto center-cropped to 16:9).

use std::path::Path;
use std::time::Duration;

use image::{DynamicImage, GenericImageView};

use crate::error::{AppError, Result};

/// Public title database (nlib.cc), returns 1920×1080 banners by Title ID
fn download_url(title_id: &str) -> String {
    format!("https://api.nlib.cc/nx/{}/banner/1920/1080", title_id.to_uppercase())
}

/// Downloads and saves as a 16:9 JPEG. Returns an error when not found
pub fn download(title_id: &str, destination: &Path) -> Result<()> {
    let agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(20))).build().new_agent();
    let not_found = || AppError::key("error_cover_not_in_library");
    let mut response = agent.get(&download_url(title_id)).call().map_err(|_| not_found())?;
    let is_image = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("image/"));
    if response.status() != 200 || !is_image {
        return Err(not_found());
    }
    let data = response.body_mut().with_config().limit(32 << 20).read_to_vec().map_err(|_| not_found())?;
    save(&data, destination)?;
    Ok(())
}

/// Saves any image as a 16:9 JPEG. Returns whether it was cropped
pub fn save(data: &[u8], destination: &Path) -> Result<bool> {
    let image = image::load_from_memory(data).map_err(|_| AppError::key("error_image_unreadable"))?;
    let (cropped, did_crop) = crop_to_16x9(image);
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let file = std::fs::File::create(destination).map_err(|_| AppError::key("error_cover_write"))?;
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(std::io::BufWriter::new(file), 90);
    encoder.encode_image(&cropped.to_rgb8()).map_err(|_| AppError::key("error_cover_write"))?;
    Ok(did_crop)
}

pub fn is_sixteen_by_nine(width: u32, height: u32) -> bool {
    height > 0 && (width as f64 / height as f64 - 16.0 / 9.0).abs() < 0.02
}

fn crop_to_16x9(image: DynamicImage) -> (DynamicImage, bool) {
    let (w, h) = image.dimensions();
    if is_sixteen_by_nine(w, h) {
        return (image, false);
    }
    let cropped = if w as f64 / h as f64 > 16.0 / 9.0 {
        let new_w = (h as f64 * 16.0 / 9.0).round() as u32;
        image.crop_imm((w - new_w) / 2, 0, new_w, h)
    } else {
        let new_h = (w as f64 * 9.0 / 16.0).round() as u32;
        image.crop_imm(0, (h - new_h) / 2, w, new_h)
    };
    (cropped, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crops_square_to_sixteen_by_nine() {
        let (image, cropped) = crop_to_16x9(DynamicImage::new_rgb8(1600, 1600));
        assert!(cropped);
        assert_eq!(image.dimensions(), (1600, 900));
        let (_, cropped) = crop_to_16x9(DynamicImage::new_rgb8(1920, 1080));
        assert!(!cropped);
    }
}
