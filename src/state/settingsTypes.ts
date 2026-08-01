/** Frontend mirror of the Rust AppSettings structure. */

export type PresetKind = "krea_2_turbo" | "qwen_image_flash";
export type EndpointTypeKind = "stable_diffusion" | "open_ai_compatible";
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
  endpointType: EndpointTypeKind;
  endpoint: string;
  apiKey: string;
  model: string;
  theme: ThemeName;
  params: GenerationParams;
}

export function defaultParams(): GenerationParams {
  return {
    width: 1024,
    height: 1536,
    steps: 30,
    strength: 0.6,
    cfgScale: 7.0,
    sampler: "Euler a",
    n: 1,
    negativePrompt: "",
  };
}

/** Generation parameters bundled under each preset name. */
export const PRESET_PARAMS: Record<PresetKind, GenerationParams> = {
  krea_2_turbo: {
    ...defaultParams(),
    width: 1024,
    height: 1024,
    steps: 8,
    strength: 0.5,
    cfgScale: 2.0,
  },
  qwen_image_flash: {
    ...defaultParams(),
    width: 1024,
    height: 1536,
    steps: 20,
  },
};

export function defaultSettings(): AppSettings {
  return {
    preset: "krea_2_turbo",
    endpointType: "stable_diffusion",
    endpoint: "http://127.0.0.1:7860",
    apiKey: "",
    model: "",
    theme: "light",
    params: { ...PRESET_PARAMS.krea_2_turbo },
  };
}
