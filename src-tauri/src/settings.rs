//! Application settings and their JSON persistence.
//!
//! The settings live in the platform config directory as `settings.json`.

use serde::{Deserialize, Serialize};
use std::path::Path;

/// A named bundle of generation parameters.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum PresetKind {
    /// Krea 2 Turbo generation settings.
    #[default]
    Krea2Turbo,
    /// Qwen Image Flash generation settings.
    QwenImageFlash,
}

/// Deserialize a preset, falling back to the default for unknown values.
impl<'de> Deserialize<'de> for PresetKind {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = Option::<String>::deserialize(deserializer)?;
        Ok(match value.as_deref() {
            Some("qwen_image_flash") => PresetKind::QwenImageFlash,
            _ => PresetKind::Krea2Turbo,
        })
    }
}

/// The schema used to talk to the image API.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum EndpointType {
    /// A Stable Diffusion style API (AUTOMATIC1111).
    #[default]
    StableDiffusion,
    /// An OpenAI-compatible images API.
    OpenAiCompatible,
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
            height: 1024,
            steps: 8,
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

/// Configuration for the completion model that drives the agent loop.
/// These fields are separate from the image generation settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CompletionSettings {
    /// Base URL of an OpenAI-compatible chat-completions endpoint.
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

impl Default for CompletionSettings {
    fn default() -> Self {
        Self {
            base_url: "https://api.openai.com/v1".into(),
            api_key: String::new(),
            model: String::new(),
        }
    }
}

/// The full set of user-configurable application settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub preset: PresetKind,
    pub endpoint_type: EndpointType,
    pub endpoint: String,
    pub api_key: String,
    pub model: String,
    pub theme: Theme,
    /// Sync board repaints to the display refresh rate.
    pub vsync: bool,
    /// Target repaint rate when vsync is off.
    pub max_fps: u32,
    pub params: GenerationParams,
    /// Completion model settings for the design agent.
    pub completion: CompletionSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            preset: PresetKind::Krea2Turbo,
            endpoint_type: EndpointType::StableDiffusion,
            endpoint: "http://127.0.0.1:7860".into(),
            api_key: String::new(),
            model: String::new(),
            theme: Theme::Light,
            vsync: true,
            max_fps: 60,
            params: GenerationParams::default(),
            completion: CompletionSettings::default(),
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
        assert_eq!(settings.preset, PresetKind::Krea2Turbo);
        assert_eq!(settings.endpoint_type, EndpointType::StableDiffusion);
        assert_eq!(settings.params.width, 1024);
        assert!(settings.params.steps >= 1);
    }

    #[test]
    fn round_trips_through_json() {
        let settings = AppSettings {
            preset: PresetKind::QwenImageFlash,
            endpoint_type: EndpointType::OpenAiCompatible,
            endpoint: "http://example.com".into(),
            api_key: "secret".into(),
            model: String::new(),
            theme: Theme::Dark,
            vsync: false,
            max_fps: 30,
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
            completion: CompletionSettings {
                base_url: "https://api.example.com/v1".into(),
                api_key: "completion-secret".into(),
                model: "gpt-agent".into(),
            },
        };
        let json = serde_json::to_string(&settings).unwrap();
        assert!(json.contains("\"qwen_image_flash\""));
        assert!(json.contains("\"open_ai_compatible\""));
        assert!(json.contains("\"completion\""));
        assert!(json.contains("\"gpt-agent\""));
        let parsed: AppSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.preset, PresetKind::QwenImageFlash);
        assert_eq!(parsed.endpoint_type, EndpointType::OpenAiCompatible);
        assert_eq!(parsed.params.sampler, "DPM++ 2M Karras");
        assert_eq!(parsed.params.negative_prompt, "blurry");
        assert_eq!(parsed.completion.model, "gpt-agent");
        assert_eq!(parsed.completion.base_url, "https://api.example.com/v1");
    }

    #[test]
    fn stored_settings_without_completion_defaults() {
        // Settings saved before the completion model existed must load.
        let old_json = r#"{
          "preset": "krea_2_turbo",
          "endpointType": "stable_diffusion",
          "endpoint": "http://127.0.0.1:7860",
          "apiKey": "",
          "model": "",
          "theme": "light",
          "vsync": true,
          "maxFps": 60,
          "params": {"width": 1024, "height": 1024, "steps": 8, "strength": 0.6, "cfgScale": 7.0, "sampler": "Euler a", "n": 1, "negativePrompt": ""}
        }"#;
        let parsed: AppSettings = serde_json::from_str(old_json).unwrap();
        assert_eq!(parsed.completion.model, "");
        assert_eq!(parsed.completion.base_url, "https://api.openai.com/v1");
        assert_eq!(parsed.theme, Theme::Light);
    }

    #[test]
    fn saves_and_loads_from_file() {
        let path = std::env::temp_dir().join(format!(
            "literative-settings-{}.json",
            std::process::id()
        ));
        let settings = AppSettings {
            preset: PresetKind::Krea2Turbo,
            endpoint_type: EndpointType::StableDiffusion,
            endpoint: "http://127.0.0.1:7860".into(),
            api_key: "".into(),
            model: "".into(),
            theme: Theme::Dark,
            vsync: true,
            max_fps: 60,
            params: GenerationParams::default(),
            completion: CompletionSettings::default(),
        };
        settings.save(&path).unwrap();
        let loaded = AppSettings::load(&path).unwrap();
        assert_eq!(loaded.preset, PresetKind::Krea2Turbo);
        assert_eq!(loaded.endpoint_type, EndpointType::StableDiffusion);
        assert_eq!(loaded.endpoint, "http://127.0.0.1:7860");
        assert_eq!(loaded.theme, Theme::Dark);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn loads_with_defaults_when_fields_are_missing() {
        let parsed: AppSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(parsed.preset, PresetKind::Krea2Turbo);
        assert_eq!(parsed.endpoint_type, EndpointType::StableDiffusion);
        assert_eq!(parsed.endpoint, "http://127.0.0.1:7860");
    }

    #[test]
    fn legacy_preset_values_fall_back_to_default() {
        let parsed: AppSettings =
            serde_json::from_str("{ \"preset\": \"open_ai_compatible\" }").unwrap();
        assert_eq!(parsed.preset, PresetKind::Krea2Turbo);
    }
}
