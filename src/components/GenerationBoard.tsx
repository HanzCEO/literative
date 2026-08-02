import { useCallback, useEffect, useRef, type RefObject } from "react";
import { PencilSimple, X } from "@phosphor-icons/react";
import { loadImage } from "../lib/file";
import type { GeneratedPoster } from "../lib/generation";
import { useSettings } from "../state/SettingsContext";
import { FIT_PADDING, useBoardViewport } from "./editor/useBoardViewport";

const POSTER_RADIUS = 12;

interface GenerationBoardProps {
  /** The shared drawing board canvas (canvas-area). */
  boardRef: RefObject<HTMLCanvasElement | null>;
  result: GeneratedPoster | null;
  error: string | null;
  posterSize: { width: number; height: number } | null;
  /** Space reserved at the bottom so the island never hides the poster. */
  bottomInset: number;
  onEdit: () => void;
  onDismiss: () => void;
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
  result,
  error,
  posterSize,
  bottomInset,
  onEdit,
  onDismiss,
  onZoomChange,
}: GenerationBoardProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const { settings } = useSettings();

  const drawRef = useRef<() => void>(() => {});
  const board = useBoardViewport(boardRef, {
    onZoomChange: (zoom: number) => onZoomChange?.(zoom),
    onRedraw: () => drawRef.current(),
    display: {
      vsync: settings?.vsync ?? true,
      maxFps: settings?.maxFps ?? 60,
    },
  });

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

    if (result) {
      const image = imageRef.current;
      if (!image) {
        return;
      }
      const scale = vp.baseFit * vp.zoom;
      const offsetX = vp.panX + (vp.contentW - result.width * scale) / 2;
      const offsetY = vp.panY + (vp.contentH - result.height * scale) / 2;
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
        result.width,
        result.height,
        POSTER_RADIUS,
      );
      context.clip();
      context.drawImage(image, 0, 0, result.width, result.height);
      context.restore();
      drawBorder(
        context,
        0,
        0,
        result.width,
        result.height,
        POSTER_RADIUS,
        1 / scale,
      );
      return;
    }

    if (posterSize) {
      const scale = vp.baseFit * vp.zoom;
      const offsetX = vp.panX + (vp.contentW - posterSize.width * scale) / 2;
      const offsetY = vp.panY + (vp.contentH - posterSize.height * scale) / 2;
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
    }
  }, [board, result, posterSize]);
  drawRef.current = draw;

  // Fit the preview into the board; the island reserves the bottom inset.
  useEffect(() => {
    if (result) {
      board.setContent(result.width, result.height);
      board.setFitCalc(
        (contentW, contentH) =>
          Math.min(
            (contentW - FIT_PADDING * 2) / result.width,
            (contentH - FIT_PADDING * 2 - bottomInset) / result.height,
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
  }, [board, result, posterSize, bottomInset]);

  // Load the generated image once and repaint when it is ready.
  useEffect(() => {
    imageRef.current = null;
    if (!result) {
      return;
    }
    let cancelled = false;
    void loadImage(result.dataUrl).then((image) => {
      if (cancelled) {
        return;
      }
      imageRef.current = image;
      drawRef.current();
    });
    return () => {
      cancelled = true;
    };
  }, [result, board]);

  // The preview has no draggable content, so every pointer press pans.
  useEffect(() => {
    const canvas = boardRef.current;
    if (!canvas) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button === 1) {
        event.preventDefault();
      }
      canvas.setPointerCapture?.(event.pointerId);
      board.beginPan(event.clientX, event.clientY);
    };
    const handlePointerMove = (event: PointerEvent) => {
      board.movePan(event.clientX, event.clientY);
    };
    const handlePointerUp = () => {
      board.endPan();
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

  return (
    <>
      {result ? (
        <div className="result-overlay" data-testid="result-overlay">
          <div className="result-actions">
            <button
              type="button"
              className="result-button"
              onClick={onEdit}
              aria-label="Edit poster"
            >
              <PencilSimple size={16} weight="bold" />
              Edit
            </button>
            <button
              type="button"
              className="result-dismiss"
              onClick={onDismiss}
              aria-label="Dismiss poster"
            >
              <X size={16} weight="bold" />
            </button>
          </div>
        </div>
      ) : null}
      {error && (
        <p className="generation-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
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
