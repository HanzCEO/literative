import { useEffect, type RefObject } from "react";
import { PencilSimple, X } from "@phosphor-icons/react";
import { loadImage } from "../lib/file";
import type { GeneratedPoster } from "../lib/generation";

const FIT_PADDING = 32;
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
}

/**
 * Draws the poster frame or the generated poster onto the canvas-area
 * canvas and hosts the result actions as DOM overlays above it.
 */
export function GenerationBoard({
  boardRef,
  result,
  error,
  posterSize,
  bottomInset,
  onEdit,
  onDismiss,
}: GenerationBoardProps) {
  useEffect(() => {
    const canvas = boardRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    if (cssWidth === 0 || cssHeight === 0) {
      return;
    }
    const style = getComputedStyle(canvas);
    const contentWidth =
      cssWidth -
      parseFloat(style.paddingLeft || "0") -
      parseFloat(style.paddingRight || "0");
    const contentHeight =
      cssHeight -
      parseFloat(style.paddingTop || "0") -
      parseFloat(style.paddingBottom || "0");
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(contentWidth * dpr));
    canvas.height = Math.max(1, Math.round(contentHeight * dpr));
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = boardBackground();
    context.fillRect(0, 0, canvas.width, canvas.height);

    const availableWidth = contentWidth - FIT_PADDING * 2;
    const availableHeight = contentHeight - FIT_PADDING * 2 - bottomInset;

    if (result) {
      let cancelled = false;
      void loadImage(result.dataUrl)
        .then((image) => {
          if (cancelled) {
            return;
          }
          const scale = Math.min(
            availableWidth / result.width,
            availableHeight / result.height,
          );
          const width = result.width * scale;
          const height = result.height * scale;
          const x = (contentWidth - width) / 2;
          const y = (contentHeight - height) / 2;
          context.save();
          context.shadowColor = "rgba(0, 0, 0, 0.30)";
          context.shadowBlur = 24 * scale;
          context.shadowOffsetY = 8 * scale;
          roundRectPath(context, x, y, width, height, POSTER_RADIUS * scale);
          context.clip();
          context.drawImage(image, x, y, width, height);
          context.restore();
          drawBorder(context, x, y, width, height, POSTER_RADIUS * scale);
        });
      return () => {
        cancelled = true;
      };
    }

    if (posterSize) {
      const scale = Math.min(
        availableWidth / posterSize.width,
        availableHeight / posterSize.height,
        1,
      );
      const width = posterSize.width * scale;
      const height = posterSize.height * scale;
      const x = (contentWidth - width) / 2;
      const y = (contentHeight - height) / 2;
      context.save();
      context.shadowColor = "rgba(0, 0, 0, 0.30)";
      context.shadowBlur = 24 * scale;
      context.shadowOffsetY = 8 * scale;
      roundRectPath(context, x, y, width, height, POSTER_RADIUS * scale);
      context.fillStyle = "#ffffff";
      context.fill();
      context.restore();
      drawBorder(context, x, y, width, height, POSTER_RADIUS * scale);
    }
  }, [boardRef, result, posterSize, bottomInset]);

  return (
    <>
      {result ? (
        <div className="result-overlay" data-testid="result-overlay">
          <span className="result-meta">
            {result.width} x {result.height} px
          </span>
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
      ) : posterSize ? (
        <span className="poster-frame-dimensions">
          {posterSize.width} x {posterSize.height} px
        </span>
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
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
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
) {
  context.save();
  context.strokeStyle = "rgba(0, 0, 0, 0.12)";
  context.lineWidth = 1;
  roundRectPath(context, x, y, width, height, radius);
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
