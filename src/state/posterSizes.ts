/** Poster size model shared by the new project form and the project record. */

export interface PosterSize {
  width: number;
  height: number;
}

/** Matches the default generation size of 1024x1536. */
export const DEFAULT_POSTER_SIZE: PosterSize = { width: 1024, height: 1536 };

export type PosterSizePresetId =
  | "a4"
  | "a5"
  | "screen_16_9"
  | "instagram_portrait"
  | "instagram_square"
  | "instagram_landscape";

export interface PosterSizePreset {
  id: PosterSizePresetId;
  label: string;
  hint: string;
  size: PosterSize;
}

/** Preset poster sizes shown as cards in the new project form. */
export const POSTER_SIZE_PRESETS: PosterSizePreset[] = [
  {
    id: "a4",
    label: "A4",
    hint: "1240 x 1754 px",
    size: { width: 1240, height: 1754 },
  },
  {
    id: "a5",
    label: "A5",
    hint: "874 x 1240 px",
    size: { width: 874, height: 1240 },
  },
  {
    id: "screen_16_9",
    label: "16:9 Screen",
    hint: "1920 x 1080 px",
    size: { width: 1920, height: 1080 },
  },
  {
    id: "instagram_portrait",
    label: "Instagram portrait",
    hint: "1080 x 1350 px",
    size: { width: 1080, height: 1350 },
  },
  {
    id: "instagram_square",
    label: "Instagram square",
    hint: "1080 x 1080 px",
    size: { width: 1080, height: 1080 },
  },
  {
    id: "instagram_landscape",
    label: "Instagram landscape",
    hint: "1080 x 566 px",
    size: { width: 1080, height: 566 },
  },
];

export function sameSize(a: PosterSize, b: PosterSize): boolean {
  return a.width === b.width && a.height === b.height;
}

/** Parse a number input value into a valid pixel size, or null. */
export function parsePixels(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed < 1 || parsed > 100000) {
    return null;
  }
  return parsed;
}
