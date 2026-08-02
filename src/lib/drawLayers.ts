/**
 * Shared canvas drawing for poster document layers. The editor canvas,
 * the generation preview, and the raster export all use these helpers
 * so a layer looks the same everywhere.
 */

import { layerBounds, type Layer, type ShapeLayer } from "../state/posterDocument";

/** Trace a rounded rectangle path on the context. */
export function roundRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.arcTo(x + width, y, x + width, y + r, r);
  context.lineTo(x + width, y + height - r);
  context.arcTo(x + width, y + height, x + width - r, y + height, r);
  context.lineTo(x + r, y + height);
  context.arcTo(x, y + height, x, y + height - r, r);
  context.lineTo(x, y + r);
  context.arcTo(x, y, x + r, y, r);
  context.closePath();
}

/** Paint a shape layer. The context must already be rotated as needed. */
function drawShape(context: CanvasRenderingContext2D, layer: ShapeLayer): void {
  context.globalCompositeOperation = "source-over";
  const { x, y, width, height } = layer;
  context.beginPath();
  if (layer.shapeType === "rect") {
    roundRectPath(context, x, y, width, height, layer.cornerRadius);
  } else if (layer.shapeType === "ellipse") {
    context.ellipse(
      x + width / 2,
      y + height / 2,
      width / 2,
      height / 2,
      0,
      0,
      Math.PI * 2,
    );
  } else {
    context.moveTo(x, y);
    context.lineTo(x + width, y + height);
  }
  if (layer.fill && layer.fill !== "#00000000") {
    context.fillStyle = layer.fill;
    context.fill();
  }
  if (layer.strokeWidth > 0) {
    context.strokeStyle = layer.stroke;
    context.lineWidth = layer.strokeWidth;
    context.stroke();
  }
}

/** The dashed blue selection outline, in the current layer space. */
export function drawLayerSelection(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  context.save();
  context.strokeStyle = "#4f8cff";
  context.lineWidth = 2;
  context.setLineDash([6, 4]);
  context.strokeRect(x, y, width, height);
  context.restore();
}

/**
 * Draw one layer at its document position with its rotation, opacity,
 * and blend mode. The selection outline is drawn in the same rotated
 * space when `selected` is true.
 */
export function drawLayer(
  context: CanvasRenderingContext2D,
  layer: Layer,
  resolveImage: (src: string) => HTMLImageElement | undefined,
  selected = false,
): void {
  context.save();
  context.globalAlpha = layer.opacity;
  const bounds = layerBounds(layer);
  const centerX = layer.x + bounds.width / 2;
  const centerY = layer.y + bounds.height / 2;
  const angle = ((layer.rotation ?? 0) * Math.PI) / 180;
  context.translate(centerX, centerY);
  if (angle !== 0) {
    context.rotate(angle);
  }
  context.translate(-centerX, -centerY);
  switch (layer.kind) {
    case "image": {
      context.globalCompositeOperation = layer.blendMode;
      const image = resolveImage(layer.src);
      if (image) {
        context.drawImage(image, layer.x, layer.y, layer.width, layer.height);
      }
      break;
    }
    case "text": {
      context.globalCompositeOperation = "source-over";
      context.fillStyle = layer.color;
      context.font = `${layer.fontSize}px "DejaVu Sans", sans-serif`;
      const lineHeight = layer.fontSize * 1.2;
      layer.text.split("\n").forEach((line, lineIndex) => {
        context.fillText(
          line,
          layer.x,
          layer.y + lineHeight * (lineIndex + 0.8),
        );
      });
      break;
    }
    case "shape":
      drawShape(context, layer);
      break;
  }
  if (selected) {
    drawLayerSelection(context, layer.x, layer.y, bounds.width, bounds.height);
  }
  context.restore();
}
