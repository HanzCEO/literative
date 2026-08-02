import { useEffect, useRef, type RefObject } from "react";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const FIT_PADDING = 32;

/** Editor chrome that scrolls or hosts controls. Wheel over it never zooms. */
const CHROME_SELECTOR = [
  ".layer-panel",
  ".editor-toolbar",
  ".app-header",
  ".island",
  ".result-overlay",
].join(", ");

/** Live viewport state shared by every board draw. */
export interface ViewportState {
  /** Device pixel ratio for backing the bitmap buffer. */
  dpr: number;
  /** Top padding on the canvas element, reserved for the fixed header. */
  padTop: number;
  /** Content box size in CSS pixels. */
  contentW: number;
  contentH: number;
  /** Base fit so the content fits the board, before user zoom. */
  baseFit: number;
  /** User zoom, clamped between MIN_ZOOM and MAX_ZOOM. */
  zoom: number;
  /** User pan offset in CSS pixels. */
  panX: number;
  panY: number;
}

interface UseBoardViewportOptions {
  /** Called with the new zoom whenever the wheel or keys change it. */
  onZoomChange: (zoom: number) => void;
  /** Called to repaint the board after the viewport changes. */
  onRedraw: () => void;
}

/**
 * Owns the viewport of the shared drawing board: fit, zoom, pan, wheel,
 * space-key panning, and the cursor. Both the preview view and the poster
 * editor mount this hook on the same canvas, so the board always behaves
 * as a viewport over the content.
 */
export function useBoardViewport(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { onZoomChange, onRedraw }: UseBoardViewportOptions,
) {
  const state = useRef<ViewportState>({
    dpr: 1,
    padTop: 0,
    contentW: 0,
    contentH: 0,
    baseFit: 0.1,
    zoom: 1,
    panX: 0,
    panY: 0,
  }).current;
  /** Size of the content in document pixels, set by each view. */
  const contentSize = useRef({ w: 1, h: 1 });
  /** Fit calculator set by each view; it knows the content padding rules. */
  const fitCalcRef = useRef<(w: number, h: number) => number>(() => 0.1);
  const redrawRef = useRef(onRedraw);
  const zoomChangeRef = useRef(onZoomChange);
  const spaceRef = useRef(false);
  const panningRef = useRef(false);
  const panDragRef = useRef<{
    startX: number;
    startY: number;
    panStartX: number;
    panStartY: number;
  } | null>(null);

  redrawRef.current = onRedraw;
  zoomChangeRef.current = onZoomChange;

  /** Size the bitmap buffer and record the content box, then repaint. */
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
      const style = getComputedStyle(canvas);
      const paddingTop = parseFloat(style.paddingTop || "0");
      const contentW =
        cssWidth - parseFloat(style.paddingLeft || "0") - parseFloat(style.paddingRight || "0");
      const contentH =
        cssHeight - paddingTop - parseFloat(style.paddingBottom || "0");
      const dpr = window.devicePixelRatio || 1;
      const pixelWidth = Math.max(1, Math.round(contentW * dpr));
      const pixelHeight = Math.max(1, Math.round(contentH * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      state.dpr = dpr;
      state.padTop = paddingTop;
      state.contentW = contentW;
      state.contentH = contentH;
      recomputeFit();
      redrawRef.current();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  /** Wheel zoom at window level: no element can swallow it. */
  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(CHROME_SELECTOR)
      ) {
        // Wheel over editor chrome scrolls or adjusts that chrome instead.
        return;
      }
      event.preventDefault();
      let delta = event.deltaY;
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        delta *= 16;
      } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        delta *= 100;
      }
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      zoomBy(Math.exp(-delta * 0.0012), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top - state.padTop,
      });
    };
    window.addEventListener("wheel", handleWheel, {
      capture: true,
      passive: false,
    });
    return () =>
      window.removeEventListener("wheel", handleWheel, { capture: true });
  }, []);

  /** Hold Space to pan the viewport, with a grab cursor. */
  useEffect(() => {
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isTyping(event.target)) {
        return;
      }
      event.preventDefault();
      if (!event.repeat) {
        spaceRef.current = true;
        updateCursor();
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }
      if (spaceRef.current) {
        spaceRef.current = false;
        updateCursor();
      }
    };
    const handleBlur = () => {
      spaceRef.current = false;
      panningRef.current = false;
      updateCursor();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  function updateCursor() {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    canvas.style.cursor = spaceRef.current
      ? "grab"
      : panningRef.current
        ? "grabbing"
        : "";
  }

  function recomputeFit() {
    state.baseFit = Math.max(
      fitCalcRef.current(state.contentW, state.contentH),
      0.01,
    );
  }

  /**
   * Set the fit calculator. Each view supplies the rule that fits its own
   * content (poster sheet or generated preview) into the board.
   */
  function setFitCalc(calc: (contentW: number, contentH: number) => number) {
    fitCalcRef.current = calc;
    recomputeFit();
  }

  /** Set the content size in document pixels. */
  function setContent(width: number, height: number) {
    contentSize.current.w = width;
    contentSize.current.h = height;
  }

  /** Zoom around an anchor point in CSS pixels relative to the canvas. */
  function zoomBy(factor: number, anchor?: { x: number; y: number }) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const oldZoom = state.zoom;
    const next = Math.min(Math.max(oldZoom * factor, MIN_ZOOM), MAX_ZOOM);
    if (next === oldZoom) {
      return;
    }
    const anchorX = anchor ? anchor.x : state.contentW / 2;
    const anchorY = anchor ? anchor.y : state.contentH / 2;
    const docW = contentSize.current.w;
    const docH = contentSize.current.h;
    const oldOffsetX =
      state.panX + (state.contentW - docW * state.baseFit * oldZoom) / 2;
    const oldOffsetY =
      state.panY + (state.contentH - docH * state.baseFit * oldZoom) / 2;
    const docX = (anchorX - oldOffsetX) / (state.baseFit * oldZoom);
    const docY = (anchorY - oldOffsetY) / (state.baseFit * oldZoom);
    state.zoom = next;
    state.panX =
      anchorX - docX * state.baseFit * next -
      (state.contentW - docW * state.baseFit * next) / 2;
    state.panY =
      anchorY - docY * state.baseFit * next -
      (state.contentH - docH * state.baseFit * next) / 2;
    zoomChangeRef.current(next);
    redrawRef.current();
  }

  /** Reset zoom to fit and clear the pan offset. */
  function resetView() {
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    zoomChangeRef.current(1);
    redrawRef.current();
  }

  /** Convert a client-space point to document coordinates. */
  function toDocPoint(clientX: number, clientY: number): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (!canvas) {
      return { x: 0, y: 0 };
    }
    const rect = canvas.getBoundingClientRect();
    const docW = contentSize.current.w;
    const docH = contentSize.current.h;
    const offsetX =
      state.panX + (state.contentW - docW * state.baseFit * state.zoom) / 2;
    const offsetY =
      state.panY + (state.contentH - docH * state.baseFit * state.zoom) / 2;
    return {
      x: (clientX - rect.left - offsetX) / (state.baseFit * state.zoom),
      y:
        (clientY - rect.top - state.padTop - offsetY) /
        (state.baseFit * state.zoom),
    };
  }

  /**
   * True when a pointer press should pan the viewport instead of touching
   * content: any button but the left one, or Space held.
   */
  function isPanOverride(button: number): boolean {
    return button !== 0 || spaceRef.current;
  }

  function beginPan(clientX: number, clientY: number) {
    if (panDragRef.current) {
      return;
    }
    panDragRef.current = {
      startX: clientX,
      startY: clientY,
      panStartX: state.panX,
      panStartY: state.panY,
    };
    panningRef.current = true;
    updateCursor();
  }

  function movePan(clientX: number, clientY: number) {
    const drag = panDragRef.current;
    if (!drag) {
      return;
    }
    state.panX = drag.panStartX + (clientX - drag.startX);
    state.panY = drag.panStartY + (clientY - drag.startY);
    redrawRef.current();
  }

  function endPan() {
    panDragRef.current = null;
    panningRef.current = false;
    updateCursor();
  }

  const apiRef = useRef<BoardViewportApi | null>(null);
  let api = apiRef.current;
  if (!api) {
    api = {
      viewport: state,
      zoomBy,
      resetView,
      toDocPoint,
      isPanOverride,
      beginPan,
      movePan,
      endPan,
      setFitCalc,
      setContent,
    };
    apiRef.current = api;
  }
  return api;
}

interface BoardViewportApi {
  /** Live viewport state read by the view draws. */
  viewport: ViewportState;
  zoomBy: (factor: number, anchor?: { x: number; y: number }) => void;
  resetView: () => void;
  toDocPoint: (clientX: number, clientY: number) => { x: number; y: number };
  isPanOverride: (button: number) => boolean;
  beginPan: (clientX: number, clientY: number) => void;
  movePan: (clientX: number, clientY: number) => void;
  endPan: () => void;
  setFitCalc: (calc: (contentW: number, contentH: number) => number) => void;
  setContent: (width: number, height: number) => void;
}
