import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { loadImage } from "./file";
import type { PosterDocument, TextLayer } from "../state/posterDocument";

/** Rasterize the background and image layers into PNG bytes. */
export async function renderCompositePng(
  poster: PosterDocument,
): Promise<Uint8Array> {
  const canvas = globalThis.document.createElement("canvas");
  canvas.width = poster.width;
  canvas.height = poster.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is not available");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const layer of poster.layers) {
    if (!layer.visible || layer.kind !== "image") {
      continue;
    }
    context.globalAlpha = layer.opacity;
    context.globalCompositeOperation = layer.blendMode;
    const image = await loadImage(layer.src);
    context.drawImage(image, layer.x, layer.y, layer.width, layer.height);
  }
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result);
      } else {
        reject(new Error("Failed to rasterize the poster"));
      }
    }, "image/png");
  });
  return new Uint8Array(await blob.arrayBuffer());
}

export interface ExportResult {
  path: string;
}

/** Ask for a path and export the poster as PNG or JPEG. Returns null on cancel. */
export async function exportPoster(
  poster: PosterDocument,
  format: "png" | "jpeg",
): Promise<ExportResult | null> {
  const extension = format === "jpeg" ? "jpg" : "png";
  const path = await save({
    defaultPath: `poster.${extension}`,
    filters: [
      {
        name: format === "jpeg" ? "JPEG image" : "PNG image",
        extensions: [extension],
      },
    ],
  });
  if (!path) {
    return null;
  }
  const composite = await renderCompositePng(poster);
  const textLayers = poster.layers
    .filter(
      (layer): layer is TextLayer => layer.visible && layer.kind === "text",
    )
    .map((layer) => ({
      text: layer.text,
      x: layer.x,
      y: layer.y,
      fontSize: layer.fontSize,
      color: layer.color,
    }));
  return invoke<ExportResult>("export_poster_to_file", {
    data: composite,
    textLayers,
    format,
    quality: 92,
    path,
  });
}
