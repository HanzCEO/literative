import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type Ref,
  type RefObject,
} from "react";
import { loadImage } from "../../lib/file";
import { useSettings } from "../../state/SettingsContext";
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
  /** True when the poster sheet itself is selected on the board. */
  sheetSelected: boolean;
  onSheetSelect: (selected: boolean) => void;
  onMoveLayer: (id: string, x: number, y: number) => void;
  /** Persist the sheet position on the board when a sheet drag ends. */
  onSheetMove: (x: number, y: number) => void;
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
  sheetSelected,
  onSheetSelect,
  onMoveLayer,
  onSheetMove,
  onZoomChange,
  canvasRef,
  ref,
}: PosterCanvasProps) {
  const loadedImages = useRef(new Map<string, HTMLImageElement>());
  const { settings } = useSettings();
  const docRef = useRef(document);
  const selectedRef = useRef(selectedId);
  const sheetSelectedRef = useRef(sheetSelected);
  const onSelectRef = useRef(onSelect);
  const onSheetSelectRef = useRef(onSheetSelect);
  const onMoveLayerRef = useRef(onMoveLayer);
  const onSheetMoveRef = useRef(onSheetMove);
  const sheetDragRef = useRef(false);
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
  sheetSelectedRef.current = sheetSelected;
  onSelectRef.current = onSelect;
  onSheetSelectRef.current = onSheetSelect;
  onMoveLayerRef.current = onMoveLayer;
  onSheetMoveRef.current = onSheetMove;

  const drawRef = useRef<() => void>(() => {});
  const board = useBoardViewport(canvasRef, {
    onZoomChange,
    onRedraw: () => drawRef.current(),
    display: {
      vsync: settings?.vsync ?? true,
      maxFps: settings?.maxFps ?? 60,
    },
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
    const offsetX =
      vp.panX +
      (vp.contentW - doc.width * scale) / 2 +
      vp.sheetX * scale;
    const offsetY =
      vp.panY +
      (vp.contentH - doc.height * scale) / 2 +
      vp.sheetY * scale;
    context.setTransform(
      vp.dpr * scale,
      0,
      0,
      vp.dpr * scale,
      vp.dpr * offsetX,
      vp.dpr * offsetY,
    );

    // Poster sheet with a drop shadow; the shadow is dropped while a
    // pan drag is active so the repaint stays cheap enough to be smooth.
    context.save();
    context.shadowColor = "rgba(0, 0, 0, 0.30)";
    context.shadowBlur = vp.interacting ? 0 : 24 * scale;
    context.shadowOffsetY = vp.interacting ? 0 : 8 * scale;
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
    // The poster sheet selection outline, just outside the frame.
    if (sheetSelectedRef.current) {
      context.save();
      context.strokeStyle = "#4f8cff";
      context.lineWidth = 2 / scale;
      context.setLineDash([6 / scale, 4 / scale]);
      roundRectPath(
        context,
        -8,
        -8,
        doc.width + 16,
        doc.height + 16,
        POSTER_RADIUS + 8,
      );
      context.stroke();
      context.restore();
    }
  }, [board]);
  drawRef.current = draw;

  // Fit the poster into the board; the hook measures the canvas and
  // owns the pan, zoom, and sheet position. The stored sheet position
  // is adopted back so the frame stays where the user left it.
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
    board.setSheetOffset(doc.sheetX ?? 0, doc.sheetY ?? 0);
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
  // select and drag the poster sheet, pan with Space plus the left
  // button, and reset the view on double-click.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        // Middle and right buttons never touch the content.
        event.preventDefault();
        return;
      }
      canvas.setPointerCapture?.(event.pointerId);
      if (board.isPanOverride(event.button)) {
        // Space held: the drag pans the viewport, not the content.
        board.beginPan(event.clientX, event.clientY);
        return;
      }
      const point = board.toDocPoint(event.clientX, event.clientY);
      const id = hitTestLayer(docRef.current, point.x, point.y);
      if (id) {
        const layer = docRef.current.layers.find((item) => item.id === id);
        if (layer) {
          onSelectRef.current(id);
          onSheetSelectRef.current(false);
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
      const doc = docRef.current;
      const onSheet =
        point.x >= 0 &&
        point.x <= doc.width &&
        point.y >= 0 &&
        point.y <= doc.height;
      if (onSheet) {
        // The poster sheet itself: select it and drag it on the board.
        onSelectRef.current(null);
        selectedRef.current = null;
        onSheetSelectRef.current(true);
        sheetSelectedRef.current = true;
        sheetDragRef.current = true;
        drawRef.current();
        board.beginSheetDrag(event.clientX, event.clientY);
        return;
      }
      // Empty board: clear the selection; the board does not pan here.
      onSelectRef.current(null);
      selectedRef.current = null;
      onSheetSelectRef.current(false);
      sheetSelectedRef.current = false;
      drawRef.current();
    };
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) {
        board.moveDrag(event.clientX, event.clientY);
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
      if (sheetDragRef.current) {
        sheetDragRef.current = false;
        // Store the position in the document so later edits keep it.
        onSheetMoveRef.current(
          board.viewport.sheetX,
          board.viewport.sheetY,
        );
      }
      board.endDrag();
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
