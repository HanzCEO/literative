import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type Ref,
  type RefObject,
} from "react";
import { loadImage } from "../../lib/file";
import {
  estimateTextWidth,
  hitTestLayer,
  type PosterDocument,
} from "../../state/posterDocument";
import { FIT_PADDING, useBoardViewport } from "./useBoardViewport";

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
  /** The shared drawing board canvas that this component draws on. */
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** Ref for the imperative zoom API. */
  ref?: Ref<PosterBoardHandle>;
}

/**
 * Poster editor board. The canvas element itself lives at the app level
 * (canvas-area); this component draws the poster and attaches the layer
 * select and drag logic to the shared viewport from useBoardViewport.
 */
export function PosterCanvas({
  document,
  selectedId,
  onSelect,
  onMoveLayer,
  onZoomChange,
  canvasRef,
  ref,
}: PosterCanvasProps) {
  const loadedImages = useRef(new Map<string, HTMLImageElement>());
  const docRef = useRef(document);
  const selectedRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);
  const onMoveLayerRef = useRef(onMoveLayer);
  const dragRef = useRef<{
    kind: "layer";
    layerId: string;
    startX: number;
    startY: number;
    layerX: number;
    layerY: number;
  } | null>(null);

  docRef.current = document;
  selectedRef.current = selectedId;
  onSelectRef.current = onSelect;
  onMoveLayerRef.current = onMoveLayer;

  const drawRef = useRef<() => void>(() => {});
  const board = useBoardViewport(canvasRef, {
    onZoomChange,
    onRedraw: () => drawRef.current(),
  });

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
    const vp = board.viewport;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = boardBackground();
    context.fillRect(0, 0, canvas.width, canvas.height);

    const scale = vp.baseFit * vp.zoom;
    const offsetX = vp.panX + (vp.contentW - doc.width * scale) / 2;
    const offsetY = vp.panY + (vp.contentH - doc.height * scale) / 2;
    context.setTransform(
      vp.dpr * scale,
      0,
      0,
      vp.dpr * scale,
      vp.dpr * offsetX,
      vp.dpr * offsetY,
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
  }, [board]);
  drawRef.current = draw;

  // Fit the poster into the board; the viewport hook measures the canvas
  // and owns the pan and zoom state.
  useEffect(() => {
    const doc = docRef.current;
    board.setContent(doc.width, doc.height);
    board.setFitCalc(
      (contentW, contentH) =>
        Math.min(
          (contentW - FIT_PADDING * 2) / doc.width,
          (contentH - FIT_PADDING * 2) / doc.height,
        ),
    );
    draw();
  }, [document, board, draw]);

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

  // Pointer interactions on the shared canvas: select and drag layers,
  // pan on empty space, and reset the view on double-click.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button === 1) {
        event.preventDefault();
      }
      canvas.setPointerCapture?.(event.pointerId);
      const panOverride = board.isPanOverride(event.button);
      const point = board.toDocPoint(event.clientX, event.clientY);
      const id = panOverride
        ? null
        : hitTestLayer(docRef.current, point.x, point.y);
      if (id) {
        const layer = docRef.current.layers.find((item) => item.id === id);
        if (layer) {
          onSelectRef.current(id);
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
      if (!panOverride) {
        onSelectRef.current(null);
      }
      board.beginPan(event.clientX, event.clientY);
    };
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) {
        board.movePan(event.clientX, event.clientY);
        return;
      }
      const point = board.toDocPoint(event.clientX, event.clientY);
      onMoveLayerRef.current(
        drag.layerId,
        Math.round(drag.layerX + point.x - drag.startX),
        Math.round(drag.layerY + point.y - drag.startY),
      );
    };
    const handlePointerUp = () => {
      dragRef.current = null;
      board.endPan();
    };
    const handleDoubleClick = (event: MouseEvent) => {
      const point = board.toDocPoint(event.clientX, event.clientY);
      if (!hitTestLayer(docRef.current, point.x, point.y)) {
        board.resetView();
      }
    };
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointerleave", handlePointerUp);
    canvas.addEventListener("dblclick", handleDoubleClick);
    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointerleave", handlePointerUp);
      canvas.removeEventListener("dblclick", handleDoubleClick);
    };
  }, [board]);

  useImperativeHandle(
    ref,
    () => ({
      zoomBy: board.zoomBy,
      resetZoom: board.resetView,
    }),
    [board],
  );

  return null;
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
  context.strokeStyle = "#4f8cff";
  context.lineWidth = 2;
  context.setLineDash([6, 4]);
  context.strokeRect(x, y, width, height);
  context.restore();
}

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
