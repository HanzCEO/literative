import { useEffect, useRef, type MouseEvent } from "react";
import { loadImage } from "../../lib/file";
import {
  estimateTextWidth,
  hitTestLayer,
  type PosterDocument,
} from "../../state/posterDocument";

interface PosterCanvasProps {
  document: PosterDocument;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMoveLayer: (id: string, x: number, y: number) => void;
}

/** Interactive canvas that renders the poster document. */
export function PosterCanvas({
  document,
  selectedId,
  onSelect,
  onMoveLayer,
}: PosterCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const loadedImages = useRef(new Map<string, HTMLImageElement>());
  const dragState = useRef<{
    layerId: string;
    startX: number;
    startY: number;
    layerX: number;
    layerY: number;
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    canvas.width = document.width;
    canvas.height = document.height;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    let cancelled = false;
    const imageLayers = document.layers.filter(
      (layer) => layer.visible && layer.kind === "image",
    );
    Promise.all(
      imageLayers.map(async (layer) => {
        if (layer.kind !== "image") {
          return;
        }
        if (!loadedImages.current.has(layer.src)) {
          loadedImages.current.set(layer.src, await loadImage(layer.src));
        }
      }),
    ).then(() => {
      if (cancelled) {
        return;
      }
      render(canvas, context, document, selectedId, loadedImages.current);
    });
    return () => {
      cancelled = true;
    };
  }, [document, selectedId]);

  function canvasPoint(event: MouseEvent): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(rect.width, 1);
    const scaleY = canvas.height / Math.max(rect.height, 1);
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  function handleMouseDown(event: MouseEvent) {
    const point = canvasPoint(event);
    const id = hitTestLayer(document, point.x, point.y);
    onSelect(id);
    if (id) {
      const layer = document.layers.find((item) => item.id === id);
      if (layer) {
        dragState.current = {
          layerId: id,
          startX: point.x,
          startY: point.y,
          layerX: layer.x,
          layerY: layer.y,
        };
      }
    }
  }

  function handleMouseMove(event: MouseEvent) {
    const drag = dragState.current;
    if (!drag) {
      return;
    }
    const point = canvasPoint(event);
    onMoveLayer(
      drag.layerId,
      Math.round(drag.layerX + point.x - drag.startX),
      Math.round(drag.layerY + point.y - drag.startY),
    );
  }

  function handleMouseUp() {
    dragState.current = null;
  }

  return (
    <canvas
      ref={canvasRef}
      className="poster-canvas"
      data-testid="poster-canvas"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    />
  );
}

function render(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  document: PosterDocument,
  selectedId: string | null,
  loadedImages: Map<string, HTMLImageElement>,
) {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (const layer of document.layers) {
    if (!layer.visible) {
      continue;
    }
    context.globalAlpha = layer.opacity;
    if (layer.kind === "image") {
      context.globalCompositeOperation = layer.blendMode;
      const image = loadedImages.get(layer.src);
      if (image) {
        context.drawImage(image, layer.x, layer.y, layer.width, layer.height);
      }
      drawSelection(context, layer.x, layer.y, layer.width, layer.height, layer.id === selectedId);
    } else {
      context.globalCompositeOperation = "source-over";
      context.fillStyle = layer.color;
      context.font = `${layer.fontSize}px "DejaVu Sans", sans-serif`;
      const lineHeight = layer.fontSize * 1.2;
      layer.text.split("\n").forEach((line, lineIndex) => {
        context.fillText(line, layer.x, layer.y + lineHeight * (lineIndex + 0.8));
      });
      drawSelection(
        context,
        layer.x,
        layer.y,
        estimateTextWidth(layer),
        layer.fontSize * 1.2,
        layer.id === selectedId,
      );
    }
  }

  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
}

function drawSelection(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  selected: boolean,
) {
  if (!selected) {
    return;
  }
  context.save();
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.setLineDash([6, 4]);
  context.strokeStyle = "#7c3aed";
  context.lineWidth = 2;
  context.strokeRect(x, y, width, height);
  context.restore();
}
