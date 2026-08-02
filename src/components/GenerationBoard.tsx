import { useCallback, useEffect, useRef, type RefObject } from "react";
import { drawLayer } from "../lib/drawLayers";
import { loadImage } from "../lib/file";
import type { PosterDocument } from "../state/posterDocument";
import { useSettings } from "../state/SettingsContext";
import { FIT_PADDING, useBoardViewport } from "./editor/useBoardViewport";

const POSTER_RADIUS = 12;

interface GenerationBoardProps {
  /** The shared drawing board canvas (canvas-area). */
  boardRef: RefObject<HTMLCanvasElement | null>;
  posterSize: { width: number; height: number } | null;
  /** The live poster document the agent edits, when an agent run is active. */
  document?: PosterDocument | null;
  /** The animated agent cursor, in document coordinates. */
  cursor?: { x: number; y: number; stamp: number } | null;
  /** Space reserved at the bottom so the island never hides the poster. */
  bottomInset: number;
  /** Reports the current zoom level so the host can show it in the navbar. */
  onZoomChange?: (zoom: number) => void;
}

/**
 * Draws the poster frame or the generated poster onto the canvas-area
 * canvas and hosts the result actions as DOM overlays above it. The
 * canvas itself behaves as a viewport: wheel zooms, and dragging pans.
 */
export function GenerationBoard({
  boardRef,
  posterSize,
  document,
  cursor,
  bottomInset,
  onZoomChange,
}: GenerationBoardProps) {
  const layerImagesRef = useRef(new Map<string, HTMLImageElement>());
  const { settings } = useSettings();
  const sheetSelectedRef = useRef(false);
  const posterRectRef = useRef<{ width: number; height: number } | null>(
    null,
  );
  posterRectRef.current = posterSize;
  const agentCursorRef = useRef(cursor);
  agentCursorRef.current = cursor;
  const agentCursorElRef = useRef<HTMLDivElement | null>(null);

  const drawRef = useRef<() => void>(() => {});
  const board = useBoardViewport(boardRef, {
    onZoomChange: (zoom: number) => onZoomChange?.(zoom),
    onRedraw: () => drawRef.current(),
    display: {
      vsync: settings?.vsync ?? true,
      maxFps: settings?.maxFps ?? 60,
    },
  });

  // Park the animated cursor over the current document point, using the
  // same fit, zoom, and pan transform as the canvas draw path.
  const placeAgentCursor = () => {
    const element = agentCursorElRef.current;
    const target = agentCursorRef.current;
    if (!element || !target) {
      return;
    }
    const size = document ?? posterSize;
    if (!size) {
      return;
    }
    const vp = board.viewport;
    const scale = vp.baseFit * vp.zoom;
    const x =
      vp.panX +
      (vp.contentW - size.width * scale) / 2 +
      vp.sheetX * scale +
      target.x * scale;
    const y =
      vp.panY +
      (vp.contentH - size.height * scale) / 2 +
      vp.sheetY * scale +
      target.y * scale;
    element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };

  // Reposition the cursor right after it mounts; the draw path keeps
  // it in sync while the user pans or zooms.
  useEffect(() => {
    if (cursor) {
      placeAgentCursor();
    }
  }, [cursor]);

  // Repaint the board: the poster frame, or the generated poster when a
  // result exists, laid out through the shared fit, zoom, and pan. The
  // dpr-scaled transform keeps the pan and zoom travel one CSS pixel
  // per CSS pixel on any screen scale.
  const draw = useCallback(() => {
    const canvas = boardRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    const vp = board.viewport;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = boardBackground();
    context.fillRect(0, 0, canvas.width, canvas.height);

    if (document) {
      // The live agent document: the sheet with its layers on top.
      const scale = vp.baseFit * vp.zoom;
      const offsetX =
        vp.panX +
        (vp.contentW - document.width * scale) / 2 +
        vp.sheetX * scale;
      const offsetY =
        vp.panY +
        (vp.contentH - document.height * scale) / 2 +
        vp.sheetY * scale;
      context.setTransform(
        vp.dpr * scale,
        0,
        0,
        vp.dpr * scale,
        vp.dpr * offsetX,
        vp.dpr * offsetY,
      );
      context.save();
      context.shadowColor = "rgba(0, 0, 0, 0.30)";
      context.shadowBlur = vp.interacting ? 0 : 24 * scale;
      context.shadowOffsetY = vp.interacting ? 0 : 8 * scale;
      roundRectPath(
        context,
        0,
        0,
        document.width,
        document.height,
        POSTER_RADIUS,
      );
      context.fillStyle = "#ffffff";
      context.fill();
      context.restore();
      drawBorder(
        context,
        0,
        0,
        document.width,
        document.height,
        POSTER_RADIUS,
        1 / scale,
      );
      for (const layer of document.layers) {
        if (!layer.visible) {
          continue;
        }
        drawLayer(
          context,
          layer,
          (src) => layerImagesRef.current.get(src),
          false,
        );
      }
      drawSheetSelection(
        context,
        document.width,
        document.height,
        scale,
        sheetSelectedRef.current,
      );
      placeAgentCursor();
      return;
    }

    if (posterSize) {
      const scale = vp.baseFit * vp.zoom;
      const offsetX =
        vp.panX +
        (vp.contentW - posterSize.width * scale) / 2 +
        vp.sheetX * scale;
      const offsetY =
        vp.panY +
        (vp.contentH - posterSize.height * scale) / 2 +
        vp.sheetY * scale;
      context.setTransform(
        vp.dpr * scale,
        0,
        0,
        vp.dpr * scale,
        vp.dpr * offsetX,
        vp.dpr * offsetY,
      );
      context.save();
      context.shadowColor = "rgba(0, 0, 0, 0.30)";
      context.shadowBlur = vp.interacting ? 0 : 24 * scale;
      context.shadowOffsetY = vp.interacting ? 0 : 8 * scale;
      roundRectPath(
        context,
        0,
        0,
        posterSize.width,
        posterSize.height,
        POSTER_RADIUS,
      );
      context.fillStyle = "#ffffff";
      context.fill();
      context.restore();
      drawBorder(
        context,
        0,
        0,
        posterSize.width,
        posterSize.height,
        POSTER_RADIUS,
        1 / scale,
      );
      drawSheetSelection(
        context,
        posterSize.width,
        posterSize.height,
        scale,
        sheetSelectedRef.current,
      );
      placeAgentCursor();
    }
  }, [board, document, posterSize]);
  drawRef.current = draw;

  // Fit the preview into the board; the island reserves the bottom inset.
  useEffect(() => {
    if (document) {
      board.setContent(document.width, document.height);
      board.setFitCalc(
        (contentW, contentH) =>
          Math.min(
            (contentW - FIT_PADDING * 2) / document.width,
            (contentH - FIT_PADDING * 2 - bottomInset) / document.height,
          ),
      );
    } else if (posterSize) {
      board.setContent(posterSize.width, posterSize.height);
      board.setFitCalc(
        (contentW, contentH) =>
          Math.min(
            (contentW - FIT_PADDING * 2) / posterSize.width,
            (contentH - FIT_PADDING * 2 - bottomInset) / posterSize.height,
            1,
          ),
      );
    }
    drawRef.current();
  }, [board, document, posterSize, bottomInset]);

  // Load image layers of the agent document and repaint when ready.
  useEffect(() => {
    if (!document) {
      return;
    }
    let cancelled = false;
    const pending = document.layers
      .filter((layer) => layer.visible && layer.kind === "image")
      .map(async (layer) => {
        if (layer.kind !== "image") {
          return;
        }
        if (!layerImagesRef.current.has(layer.src)) {
          layerImagesRef.current.set(layer.src, await loadImage(layer.src));
        }
      });
    void Promise.all(pending).then(() => {
      if (!cancelled) {
        drawRef.current();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [document, board]);

  // The preview has no layer editing: Space plus the left button pans
  // the viewport, and dragging the poster sheet itself moves it on the
  // board. Empty board presses only clear the selection.
  useEffect(() => {
    const canvas = boardRef.current;
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
      const size = posterRectRef.current;
      const onSheet =
        size !== null &&
        point.x >= 0 &&
        point.x <= size.width &&
        point.y >= 0 &&
        point.y <= size.height;
      if (onSheet) {
        sheetSelectedRef.current = true;
        drawRef.current();
        board.beginSheetDrag(event.clientX, event.clientY);
        return;
      }
      sheetSelectedRef.current = false;
      drawRef.current();
    };
    const handlePointerMove = (event: PointerEvent) => {
      board.moveDrag(event.clientX, event.clientY);
    };
    const handlePointerUp = () => {
      board.endDrag();
    };
    const handleDoubleClick = () => {
      board.resetView();
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

  return cursor ? (
    <div
      ref={agentCursorElRef}
      className="agent-cursor"
      aria-hidden="true"
    >
      <span key={cursor.stamp} className="agent-cursor-ring" />
      <span key={`dot-${cursor.stamp}`} className="agent-cursor-dot" />
    </div>
  ) : null;
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

// Dashed blue outline just outside the sheet when it is selected.
function drawSheetSelection(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  scale: number,
  selected: boolean,
) {
  if (!selected) {
    return;
  }
  context.save();
  context.strokeStyle = "#4f8cff";
  context.lineWidth = 2 / scale;
  context.setLineDash([6 / scale, 4 / scale]);
  roundRectPath(
    context,
    -8,
    -8,
    width + 16,
    height + 16,
    POSTER_RADIUS + 8,
  );
  context.stroke();
  context.restore();
}

function drawBorder(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  lineWidth: number = 1,
) {
  context.save();
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
  context.strokeStyle = "rgba(0, 0, 0, 0.25)";
  context.lineWidth = lineWidth;
  context.stroke();
  context.restore();
}

/** Read the theme background color so the board matches the app chrome. */
function boardBackground(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--bg")
    .trim();
  return value || "#eef0f4";
}
