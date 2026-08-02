import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";
import { loadImage } from "../../lib/file";
import {
  estimateTextWidth,
  hitTestLayer,
  type PosterDocument,
} from "../../state/posterDocument";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const FIT_PADDING = 32;
const POSTER_RADIUS = 12;

/** Imperative zoom API that the editor toolbar and shortcuts call. */
export interface PosterBoardHandle {
  zoomBy: (factor: number, anchor?: { x: number; y: number }) => void;
  resetZoom: () => void;
}

interface PosterCanvasProps {
  document: PosterDocument;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMoveLayer: (id: string, x: number, y: number) => void;
  onZoomChange: (zoom: number) => void;
  /** Ref for the imperative zoom API. */
  ref?: Ref<PosterBoardHandle>;
}

/**
 * Full-bleed drawing board. The canvas covers the whole editor page and
 * renders the poster with a draw-time transform, so zoom and pan never
 * resize DOM layout and never depend on scroll containers.
 */
export function PosterCanvas({
  document,
  selectedId,
  onSelect,
  onMoveLayer,
  onZoomChange,
  ref,
}: PosterCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const loadedImages = useRef(new Map<string, HTMLImageElement>());
  const docRef = useRef(document);
  const selectedRef = useRef(selectedId);
  const dprRef = useRef(1);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const fitRef = useRef(0.1);
  const dragRef = useRef<
    | { kind: "layer"; layerId: string; startX: number; startY: number; layerX: number; layerY: number }
    | { kind: "pan"; startClientX: number; startClientY: number; panStartX: number; panStartY: number }
    | null
  >(null);

  docRef.current = document;
  selectedRef.current = selectedId;

  function roundRectPath(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.lineTo(x + width - radius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + radius);
    context.lineTo(x + width, y + height - radius);
    context.quadraticCurveTo(
      x + width,
      y + height,
      x + width - radius,
      y + height,
    );
    context.lineTo(x + radius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - radius);
    context.lineTo(x, y + radius);
    context.quadraticCurveTo(x, y, x + radius, y);
    context.closePath();
  }

  // Repaint the whole board. The draw transform maps document pixels to
  // CSS pixels through fit * zoom, then pans with the stored offset.
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    const doc = docRef.current;
    const selected = selectedRef.current;
    const dpr = dprRef.current;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = boardBackground();
    context.fillRect(0, 0, canvas.width, canvas.height);

    const fit = fitRef.current;
    const zoom = zoomRef.current;
    const offsetX = panRef.current.x + (width - doc.width * fit * zoom) / 2;
    const offsetY = panRef.current.y + (height - doc.height * fit * zoom) / 2;
    const scale = fit * zoom;
    context.setTransform(
      dpr * scale,
      0,
      0,
      dpr * scale,
      dpr * offsetX,
      dpr * offsetY,
    );

    // Poster sheet with a drop shadow.
    context.save();
    context.shadowColor = "rgba(0, 0, 0, 0.30)";
    context.shadowBlur = 24 * scale;
    context.shadowOffsetY = 8 * scale;
    roundRectPath(context, 0, 0, doc.width, doc.height, POSTER_RADIUS);
    context.fillStyle = "#ffffff";
    context.fill();
    context.restore();

    // Layers in document order.
    const images = loadedImages.current;
    for (const layer of doc.layers) {
      if (!layer.visible) {
        continue;
      }
      context.globalAlpha = layer.opacity;
      if (layer.kind === "image") {
        context.globalCompositeOperation = layer.blendMode;
        const image = images.get(layer.src);
        if (image) {
          context.drawImage(
            image,
            layer.x,
            layer.y,
            layer.width,
            layer.height,
          );
        }
        drawSelection(
          context,
          layer.x,
          layer.y,
          layer.width,
          layer.height,
          layer.id === selected,
        );
      } else {
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
        drawSelection(
          context,
          layer.x,
          layer.y,
          estimateTextWidth(layer),
          layer.fontSize * 1.2,
          layer.id === selected,
        );
      }
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
  }, []);

  // Fit the poster into the board and match the canvas pixel buffer to the
  // element size. The initial observe call measures right after mount.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const measure = () => {
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      if (cssWidth === 0 || cssHeight === 0) {
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      const pixelWidth = Math.round(cssWidth * dpr);
      const pixelHeight = Math.round(cssHeight * dpr);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      dprRef.current = dpr;
      const doc = docRef.current;
      const scale = Math.min(
        (cssWidth - FIT_PADDING * 2) / doc.width,
        (cssHeight - FIT_PADDING * 2) / doc.height,
      );
      fitRef.current = Math.max(scale, 0.01);
      draw();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  // Load image layers once and repaint when the document or selection
  // changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
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
      draw();
    });
    return () => {
      cancelled = true;
    };
  }, [document, selectedId, draw]);

  // Plain wheel and Ctrl or Cmd wheel both zoom toward the cursor. Plain
  // wheel needs no modifier, so no webview can intercept it.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      let delta = event.deltaY;
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        delta *= 16;
      } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        delta *= 100;
      }
      const rect = canvas.getBoundingClientRect();
      zoomBy(
        Math.exp(-delta * 0.0012),
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
      );
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [draw]);

  // Convert a client-space point to document coordinates.
  function toDocumentPoint(
    clientX: number,
    clientY: number,
  ): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const dpr = dprRef.current;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    const doc = docRef.current;
    const fit = fitRef.current;
    const zoom = zoomRef.current;
    const offsetX = panRef.current.x + (width - doc.width * fit * zoom) / 2;
    const offsetY = panRef.current.y + (height - doc.height * fit * zoom) / 2;
    return {
      x: (clientX - rect.left - offsetX) / (fit * zoom),
      y: (clientY - rect.top - offsetY) / (fit * zoom),
    };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    canvas.setPointerCapture?.(event.pointerId);
    const point = toDocumentPoint(event.clientX, event.clientY);
    const id = hitTestLayer(docRef.current, point.x, point.y);
    if (id) {
      const layer = docRef.current.layers.find((item) => item.id === id);
      if (layer) {
        onSelect(id);
        dragRef.current = {
          kind: "layer",
          layerId: id,
          startX: point.x,
          startY: point.y,
          layerX: layer.x,
          layerY: layer.y,
        };
      }
      return;
    }
    onSelect(null);
    dragRef.current = {
      kind: "pan",
      startClientX: event.clientX,
      startClientY: event.clientY,
      panStartX: panRef.current.x,
      panStartY: panRef.current.y,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    if (drag.kind === "layer") {
      const point = toDocumentPoint(event.clientX, event.clientY);
      onMoveLayer(
        drag.layerId,
        Math.round(drag.layerX + point.x - drag.startX),
        Math.round(drag.layerY + point.y - drag.startY),
      );
      return;
    }
    panRef.current.x = drag.panStartX + (event.clientX - drag.startClientX);
    panRef.current.y = drag.panStartY + (event.clientY - drag.startClientY);
    draw();
  }

  function handlePointerUp() {
    dragRef.current = null;
  }

  function handleDoubleClick(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = toDocumentPoint(event.clientX, event.clientY);
    if (!hitTestLayer(docRef.current, point.x, point.y)) {
      resetZoom();
    }
  }

  // Zoom the board around an anchor point in CSS pixels relative to the
  // canvas. The document point under the anchor stays fixed on screen.
  function zoomBy(
    factor: number,
    anchor?: { x: number; y: number },
  ) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const dpr = dprRef.current;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    const doc = docRef.current;
    const fit = fitRef.current;
    const oldZoom = zoomRef.current;
    const next = Math.min(Math.max(oldZoom * factor, MIN_ZOOM), MAX_ZOOM);
    if (next === oldZoom) {
      return;
    }
    const anchorX = anchor ? anchor.x : width / 2;
    const anchorY = anchor ? anchor.y : height / 2;
    const oldOffsetX = panRef.current.x + (width - doc.width * fit * oldZoom) / 2;
    const oldOffsetY = panRef.current.y + (height - doc.height * fit * oldZoom) / 2;
    const docX = (anchorX - oldOffsetX) / (fit * oldZoom);
    const docY = (anchorY - oldOffsetY) / (fit * oldZoom);
    zoomRef.current = next;
    panRef.current.x =
      anchorX - docX * fit * next - (width - doc.width * fit * next) / 2;
    panRef.current.y =
      anchorY - docY * fit * next - (height - doc.height * fit * next) / 2;
    onZoomChange(next);
    draw();
  }

  function resetZoom() {
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    onZoomChange(1);
    draw();
  }

  useImperativeHandle(
    ref,
    () => ({
      zoomBy,
      resetZoom,
    }),
    [draw, onZoomChange],
  );

  return (
    <canvas
      ref={canvasRef}
      className="poster-canvas"
      data-testid="poster-canvas"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onDoubleClick={handleDoubleClick}
    />
  );
}

/** Read the theme background color so the board matches the app chrome. */
function boardBackground(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--bg")
    .trim();
  return value || "#eef0f4";
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
  context.strokeStyle = "#16a34a";
  context.lineWidth = 2;
  context.strokeRect(x, y, width, height);
  context.restore();
}
