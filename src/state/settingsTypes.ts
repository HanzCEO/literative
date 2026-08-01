/** Frontend mirror of the Rust AppSettings structure. */

export type PresetKind = "open_ai_compatible" | "stable_diffusion";
export type ThemeName = "light" | "dark";

export interface GenerationParams {
  width: number;
  height: number;
  steps: number;
  strength: number;
  cfgScale: number;
  sampler: string;
  n: number;
  negativePrompt: string;
}

export interface AppSettings {
  preset: PresetKind;
  endpoint: string;
  apiKey: string;
  model: string;
  theme: ThemeName;
  params: GenerationParams;
}

export function defaultSettings(): AppSettings {
  return {
    preset: "open_ai_compatible",
    endpoint: "http://127.0.0.1:8000",
    apiKey: "",
    model: "",
    theme: "light",
    params: {
      width: 1024,
      height: 1536,
      steps: 30,
      strength: 0.6,
      cfgScale: 7.0,
      sampler: "Euler a",
      n: 1,
      negativePrompt: "",
    },
  };
}
