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
  /** Rotation in degrees, clockwise, around the layer center. */
  rotation: number;
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

export type ShapeType = "rect" | "ellipse" | "line";

export const SHAPE_TYPES: ShapeType[] = ["rect", "ellipse", "line"];

export interface ShapeLayer extends LayerBase {
  kind: "shape";
  shapeType: ShapeType;
  /** Fill color with alpha, for example "#ff0000ff". Not used for lines. */
  fill: string;
  /** Stroke color with alpha, for example "#ff0000ff". */
  stroke: string;
  /** Stroke width in poster pixels. */
  strokeWidth: number;
  /** Corner radius in poster pixels, used by rect only. */
  cornerRadius: number;
  /**
   * Bounding box size in poster pixels. A line runs from the point
   * (x, y) to the point (x + width, y + height).
   */
  width: number;
  height: number;
}

export type Layer = ImageLayer | TextLayer | ShapeLayer;

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
    rotation: 0,
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
    rotation: 0,
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
    rotation: 0,
    text: "Your text",
    fontSize: Math.max(24, Math.round(posterWidth * 0.05)),
    color: "#1a1a1f",
  };
}

/**
 * Create a shape layer. The default fill and stroke are dark; a line
 * has a visible stroke width so it is never invisible.
 */
export function createShapeLayer(
  x: number,
  y: number,
  width: number,
  height: number,
  shapeType: ShapeType,
  overrides: Partial<
    Omit<
      ShapeLayer,
      "id" | "kind" | "shapeType" | "x" | "y" | "width" | "height"
    >
  > = {},
): ShapeLayer {
  const isLine = shapeType === "line";
  return {
    id: nextId(),
    kind: "shape",
    name: isLine ? "Line" : shapeType === "rect" ? "Rectangle" : "Ellipse",
    visible: true,
    opacity: 1,
    blendMode: "source-over",
    x,
    y,
    rotation: 0,
    width,
    height,
    shapeType,
    fill: isLine ? "#00000000" : "#1a1a1f",
    stroke: "#1a1a1f",
    strokeWidth: isLine ? 4 : 0,
    cornerRadius: 0,
    ...overrides,
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

/** The rendered size of a layer in poster pixels. */
export function layerBounds(layer: Layer): {
  width: number;
  height: number;
} {
  switch (layer.kind) {
    case "image":
      return { width: layer.width, height: layer.height };
    case "text":
      return {
        width: estimateTextWidth(layer),
        height: layer.fontSize * 1.2,
      };
    case "shape":
      return { width: layer.width, height: layer.height };
  }
}

/**
 * Transform a point into the unrotated space of a layer. Rotation is
 * clockwise in degrees around the layer center.
 */
function toLayerSpace(
  layer: Layer,
  bounds: { width: number; height: number },
  x: number,
  y: number,
): { x: number; y: number } {
  const angle = ((layer.rotation ?? 0) * Math.PI) / 180;
  if (angle === 0) {
    return { x, y };
  }
  const centerX = layer.x + bounds.width / 2;
  const centerY = layer.y + bounds.height / 2;
  const dx = x - centerX;
  const dy = y - centerY;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  return {
    x: centerX + dx * cos - dy * sin,
    y: centerY + dx * sin + dy * cos,
  };
}

/** True when a point lies inside a rounded rectangle. */
function hitRoundedRect(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): boolean {
  if (x < 0 || x > width || y < 0 || y > height) {
    return false;
  }
  const r = Math.min(radius, width / 2, height / 2);
  if (r <= 0) {
    return true;
  }
  const cornerX = Math.min(Math.max(x, r), width - r);
  const cornerY = Math.min(Math.max(y, r), height - r);
  const dx = x - cornerX;
  const dy = y - cornerY;
  return dx * dx + dy * dy <= r * r;
}

/** True when a point lies within the stroke distance of a segment. */
function hitSegment(
  x: number,
  y: number,
  width: number,
  height: number,
  strokeWidth: number,
): boolean {
  const radius = Math.max(strokeWidth / 2, 2);
  const dx = width;
  const dy = height;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) {
    return Math.hypot(x, y) <= radius;
  }
  const t = Math.max(0, Math.min(1, (x * dx + y * dy) / lengthSq));
  const px = x - t * dx;
  const py = y - t * dy;
  return px * px + py * py <= radius * radius;
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
    const bounds = layerBounds(layer);
    const point = toLayerSpace(layer, bounds, x, y);
    let hit = false;
    switch (layer.kind) {
      case "image":
      case "text":
        hit =
          point.x >= layer.x &&
          point.x <= layer.x + bounds.width &&
          point.y >= layer.y &&
          point.y <= layer.y + bounds.height;
        break;
      case "shape": {
        const localX = point.x - layer.x;
        const localY = point.y - layer.y;
        if (layer.shapeType === "rect") {
          hit = hitRoundedRect(
            localX,
            localY,
            layer.width,
            layer.height,
            layer.cornerRadius,
          );
        } else if (layer.shapeType === "ellipse") {
          const rx = Math.max(layer.width / 2, 0.5);
          const ry = Math.max(layer.height / 2, 0.5);
          const dx = (localX - layer.width / 2) / rx;
          const dy = (localY - layer.height / 2) / ry;
          hit = dx * dx + dy * dy <= 1;
        } else {
          hit = hitSegment(
            localX,
            localY,
            layer.width,
            layer.height,
            layer.strokeWidth,
          );
        }
        break;
      }
    }
    if (hit) {
      return layer.id;
    }
  }
  return null;
}
