import { invoke } from "@tauri-apps/api/core";

/** Return true when the file is a raster image the app can display. */
export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

/** Read a file as a base64 data URL. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Read a file as raw bytes and return them as a base64 string. */
export async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Load an image element from a source URL or data URL. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image from ${src}`));
    image.src = src;
  });
}

interface ReferencePayload {
  name: string;
  mimeType: string;
  dataBase64: string;
}

/** Convert a base64 string into raw bytes. */
function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Read the picked image paths through the Rust backend into File objects. */
export async function readReferenceFiles(paths: string[]): Promise<File[]> {
  if (paths.length === 0) {
    return [];
  }
  const payloads = await invoke<ReferencePayload[]>(
    "read_reference_images",
    { paths },
  );
  return payloads.map(
    (payload) =>
      new File([base64ToBytes(payload.dataBase64)], payload.name, {
        type: payload.mimeType,
      }),
  );
}
