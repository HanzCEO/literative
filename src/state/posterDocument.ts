/** Poster document model shared by the editor, canvas, and export. */

export type BlendMode =
  | "source-over"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "difference"
  | "exclusion";

export const BLEND_MODES: BlendMode[] = [
  "source-over",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "difference",
  "exclusion",
];

export interface LayerBase {
  id: string;
  name: string;
  visible: boolean;
  /** Opacity from 0 to 1. */
  opacity: number;
  blendMode: BlendMode;
  /** Position in poster pixels. */
  x: number;
  y: number;
}

export interface ImageLayer extends LayerBase {
  kind: "image";
  /** Data URL of the source image. */
  src: string;
  /** Display size in poster pixels. */
  width: number;
  height: number;
}

export interface TextLayer extends LayerBase {
  kind: "text";
  text: string;
  fontSize: number;
  /** Hex color with alpha, for example "#ff0000ff". */
  color: string;
}

export type Layer = ImageLayer | TextLayer;

export interface PosterDocument {
  width: number;
  height: number;
  /** Index 0 is the bottom layer. */
  layers: Layer[];
  /** Position of the sheet on the board, in document pixels. */
  sheetX: number;
  sheetY: number;
}

let idCounter = 0;

function nextId(): string {
  idCounter += 1;
  return `layer-${idCounter}`;
}

export function createDocument(width: number, height: number): PosterDocument {
  return { width, height, layers: [], sheetX: 0, sheetY: 0 };
}

/** Create a document whose base layer is an image covering the full canvas. */
export function createDocumentFromImage(
  width: number,
  height: number,
  src: string,
): PosterDocument {
  const document = createDocument(width, height);
  document.layers.push({
    id: nextId(),
    kind: "image",
    name: "Generated poster",
    visible: true,
    opacity: 1,
    blendMode: "source-over",
    x: 0,
    y: 0,
    src,
    width,
    height,
  });
  return document;
}

/**
 * Create a document at the poster size with the image fitted and centered.
 * The image keeps its ratio and fills as much of the canvas as possible.
 */
export function createDocumentWithImage(
  posterWidth: number,
  posterHeight: number,
  imageWidth: number,
  imageHeight: number,
  src: string,
): PosterDocument {
  const document = createDocument(posterWidth, posterHeight);
  const scale = Math.min(
    posterWidth / imageWidth,
    posterHeight / imageHeight,
  );
  const width = Math.max(1, Math.round(imageWidth * scale));
  const height = Math.max(1, Math.round(imageHeight * scale));
  document.layers.push({
    id: nextId(),
    kind: "image",
    name: "Generated poster",
    visible: true,
    opacity: 1,
    blendMode: "source-over",
    x: Math.round((posterWidth - width) / 2),
    y: Math.round((posterHeight - height) / 2),
    src,
    width,
    height,
  });
  return document;
}

export function createTextLayer(
  x: number,
  y: number,
  posterWidth: number,
): TextLayer {
  return {
    id: nextId(),
    kind: "text",
    name: "Text layer",
    visible: true,
    opacity: 1,
    blendMode: "source-over",
    x,
    y,
    text: "Your text",
    fontSize: Math.max(24, Math.round(posterWidth * 0.05)),
    color: "#1a1a1f",
  };
}

/** Fit an image of the given size into the poster while keeping the ratio. */
export function fitInto(
  imageWidth: number,
  imageHeight: number,
  posterWidth: number,
  posterHeight: number,
): { width: number; height: number } {
  const maxWidth = posterWidth * 0.8;
  const maxHeight = posterHeight * 0.8;
  const scale = Math.min(maxWidth / imageWidth, maxHeight / imageHeight, 1);
  return {
    width: Math.max(1, Math.round(imageWidth * scale)),
    height: Math.max(1, Math.round(imageHeight * scale)),
  };
}

/** Estimate the rendered width of text at a font size. */
export function estimateTextWidth(layer: TextLayer): number {
  return Math.max(layer.text.length, 1) * layer.fontSize * 0.55;
}

/** Return the id of the topmost visible layer at a point, or null. */
export function hitTestLayer(
  document: PosterDocument,
  x: number,
  y: number,
): string | null {
  for (let index = document.layers.length - 1; index >= 0; index -= 1) {
    const layer = document.layers[index];
    if (!layer.visible) {
      continue;
    }
    const hit =
      layer.kind === "image"
        ? x >= layer.x &&
          x <= layer.x + layer.width &&
          y >= layer.y &&
          y <= layer.y + layer.height
        : x >= layer.x &&
          x <= layer.x + estimateTextWidth(layer) &&
          y >= layer.y &&
          y <= layer.y + layer.fontSize * 1.2;
    if (hit) {
      return layer.id;
    }
  }
  return null;
}
