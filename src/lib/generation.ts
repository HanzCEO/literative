import { invoke } from "@tauri-apps/api/core";
import { fileToBase64 } from "./file";
import type { ReferenceImage } from "../state/MoodboardContext";

export interface GeneratedPoster {
  dataUrl: string;
  width: number;
  height: number;
}

/** Run a generation through the Rust backend. */
export async function generatePoster(
  prompt: string,
  references: ReferenceImage[],
): Promise<GeneratedPoster> {
  const payload = await Promise.all(
    references.map(async (reference) => ({
      name: reference.name,
      mimeType: reference.mimeType,
      dataBase64: await fileToBase64(reference.file),
    })),
  );
  return invoke<GeneratedPoster>("generate_poster", {
    prompt,
    references: payload,
  });
}

/** Extract a readable message from an unknown error value. */
export function errorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (
    error !== null &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "Generation failed";
}
