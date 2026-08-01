//! Application settings and their JSON persistence.
//!
//! The settings live in the platform config directory as `settings.json`.

use serde::{Deserialize, Serialize};
use std::path::Path;

/// The schema used to talk to the image API.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum PresetKind {
    /// An OpenAI-compatible images API.
    #[default]
    OpenAiCompatible,
    /// A Stable Diffusion style API (AUTOMATIC1111).
    StableDiffusion,
}

/// Fine-tuning parameters for image generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GenerationParams {
    pub width: u32,
    pub height: u32,
    pub steps: u32,
    pub strength: f32,
    pub cfg_scale: f32,
    pub sampler: String,
    pub n: u32,
    pub negative_prompt: String,
}

impl Default for GenerationParams {
    fn default() -> Self {
        Self {
            width: 1024,
            height: 1536,
            steps: 30,
            strength: 0.6,
            cfg_scale: 7.0,
            sampler: "Euler a".into(),
            n: 1,
            negative_prompt: String::new(),
        }
    }
}

/// The UI color scheme.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    #[default]
    Light,
    Dark,
}

/// The full set of user-configurable application settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub preset: PresetKind,
    pub endpoint: String,
    pub api_key: String,
    pub model: String,
    pub theme: Theme,
    pub params: GenerationParams,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            preset: PresetKind::OpenAiCompatible,
            endpoint: "http://127.0.0.1:8000".into(),
            api_key: String::new(),
            model: String::new(),
            theme: Theme::Light,
            params: GenerationParams::default(),
        }
    }
}

impl AppSettings {
    /// Load settings from a JSON file.
    pub fn load(path: &Path) -> Result<Self, String> {
        let content = std::fs::read_to_string(path).map_err(|err| err.to_string())?;
        serde_json::from_str(&content).map_err(|err| err.to_string())
    }

    /// Save settings to a JSON file, creating parent directories as needed.
    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let content =
            serde_json::to_string_pretty(self).map_err(|err| err.to_string())?;
        std::fs::write(path, content).map_err(|err| err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_sane() {
        let settings = AppSettings::default();
        assert_eq!(settings.preset, PresetKind::OpenAiCompatible);
        assert_eq!(settings.params.width, 1024);
        assert!(settings.params.steps >= 10);
    }

    #[test]
    fn round_trips_through_json() {
        let settings = AppSettings {
            preset: PresetKind::StableDiffusion,
            endpoint: "http://example.com".into(),
            api_key: "secret".into(),
            model: String::new(),
            theme: Theme::Dark,
            params: GenerationParams {
                width: 512,
                height: 768,
                steps: 25,
                strength: 0.4,
                cfg_scale: 6.5,
                sampler: "DPM++ 2M Karras".into(),
                n: 2,
                negative_prompt: "blurry".into(),
            },
        };
        let json = serde_json::to_string(&settings).unwrap();
        let parsed: AppSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.preset, PresetKind::StableDiffusion);
        assert_eq!(parsed.params.sampler, "DPM++ 2M Karras");
        assert_eq!(parsed.params.negative_prompt, "blurry");
        assert_eq!(parsed.theme, Theme::Dark);
    }

    #[test]
    fn saves_and_loads_from_file() {
        let path = std::env::temp_dir().join(format!(
            "literative-settings-{}.json",
            std::process::id()
        ));
        let settings = AppSettings {
            preset: PresetKind::StableDiffusion,
            endpoint: "http://127.0.0.1:7860".into(),
            api_key: "".into(),
            model: "".into(),
            theme: Theme::Dark,
            params: GenerationParams::default(),
        };
        settings.save(&path).unwrap();
        let loaded = AppSettings::load(&path).unwrap();
        assert_eq!(loaded.preset, PresetKind::StableDiffusion);
        assert_eq!(loaded.endpoint, "http://127.0.0.1:7860");
        assert_eq!(loaded.theme, Theme::Dark);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn loads_with_defaults_when_fields_are_missing() {
        let parsed: AppSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(parsed.preset, PresetKind::OpenAiCompatible);
        assert_eq!(parsed.endpoint, "http://127.0.0.1:8000");
    }
}
