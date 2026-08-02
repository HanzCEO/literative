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

/**
 * App-level settings shared by every project.
 * The preset and params act as defaults for new projects.
 */
export interface GlobalSettings {
  preset: PresetKind;
  endpointType: EndpointTypeKind;
  endpoint: string;
  apiKey: string;
  model: string;
  theme: ThemeName;
  /** Sync board repaints to the display refresh rate. */
  vsync: boolean;
  /** Target repaint rate when vsync is off. */
  maxFps: number;
  params: GenerationParams;
  /** Completion model settings for the design agent. */
  completion: CompletionSettings;
}

/** Configuration of the completion model that drives the agent. */
export interface CompletionSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Generation settings stored on a single project. */
export interface ProjectSettings {
  preset: PresetKind;
  params: GenerationParams;
}

export function defaultParams(): GenerationParams {
  return {
    width: 1024,
    height: 1024,
    steps: 8,
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

export function defaultGlobalSettings(): GlobalSettings {
  return {
    preset: "krea_2_turbo",
    endpointType: "stable_diffusion",
    endpoint: "http://127.0.0.1:7860",
    apiKey: "",
    model: "",
    theme: "light",
    vsync: true,
    maxFps: 60,
    params: { ...PRESET_PARAMS.krea_2_turbo },
    completion: {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "deepseek-v4-flash",
    },
  };
}

/** Fallback project settings for projects without stored settings. */
export function defaultProjectSettings(): ProjectSettings {
  return {
    preset: "krea_2_turbo",
    params: { ...PRESET_PARAMS.krea_2_turbo },
  };
}
