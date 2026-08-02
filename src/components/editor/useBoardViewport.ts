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

/** Read the theme background color so the board matches the app chrome. */
function boardBackground(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--bg")
    .trim();
  return value || "#eef0f4";
}

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
  /** True while a pan drag is active; views drop expensive effects. */
  interacting: boolean;
}

interface UseBoardViewportOptions {
  /** Called with the new zoom whenever the wheel or keys change it. */
  onZoomChange: (zoom: number) => void;
  /** Called to repaint the board after the viewport changes. */
  onRedraw: () => void;
  /** Repaint pacing: vsync follows the display, maxFps caps the timer. */
  display: { vsync: boolean; maxFps: number };
}

/**
 * Owns the viewport of the shared drawing board: fit, zoom, pan, wheel,
 * space-key panning, and the cursor. Both the preview view and the poster
 * editor mount this hook on the same canvas, so the board always behaves
 * as a viewport over the content.
 */
export function useBoardViewport(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { onZoomChange, onRedraw, display }: UseBoardViewportOptions,
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
    interacting: false,
  }).current;
  /** Size of the content in document pixels, set by each view. */
  const contentSize = useRef({ w: 1, h: 1 });
  /** Fit calculator set by each view; it knows the content padding rules. */
  const fitCalcRef = useRef<(w: number, h: number) => number>(() => 0.1);
  const redrawRef = useRef(onRedraw);
  const zoomChangeRef = useRef(onZoomChange);
  const displayRef = useRef(display);
  const spaceRef = useRef(false);
  const panningRef = useRef(false);
  const panDragRef = useRef<{
    startX: number;
    startY: number;
    panStartX: number;
    panStartY: number;
  } | null>(null);
  const pendingPanRef = useRef<{ x: number; y: number } | null>(null);
  const panFrameRef = useRef<number | null>(null);
  const panFrameKindRef = useRef<"raf" | "timeout" | null>(null);
  const panCacheRef = useRef<HTMLCanvasElement | null>(null);
  const panCacheValidRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  redrawRef.current = onRedraw;
  zoomChangeRef.current = onZoomChange;
  displayRef.current = display;

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
      panCacheValidRef.current = false;
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
      endPan();
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
    panCacheValidRef.current = false;
    recomputeFit();
  }

  /** Set the content size in document pixels. */
  function setContent(width: number, height: number) {
    contentSize.current.w = width;
    contentSize.current.h = height;
    panCacheValidRef.current = false;
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
    panCacheValidRef.current = false;
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
    panCacheValidRef.current = false;
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
    panStartRef.current = { x: state.panX, y: state.panY };
    panningRef.current = true;
    state.interacting = true;
    capturePanCache();
    updateCursor();
  }

  // Schedule the next pan repaint. With vsync on, requestAnimationFrame
  // follows the display refresh; with vsync off, a timer enforces the
  // configured max FPS cap.
  function schedulePanFrame(applyPan: () => void): number {
    const display = displayRef.current;
    if (display.vsync && typeof requestAnimationFrame === "function") {
      panFrameKindRef.current = "raf";
      return requestAnimationFrame(applyPan);
    }
    panFrameKindRef.current = "timeout";
    const fps = Math.min(Math.max(display.maxFps, 1), 240);
    const interval = Math.max(1, Math.round(1000 / fps));
    return window.setTimeout(applyPan, interval);
  }

  function cancelPanFrame() {
    if (panFrameRef.current === null) {
      return;
    }
    if (panFrameKindRef.current === "raf") {
      cancelAnimationFrame(panFrameRef.current);
    } else {
      clearTimeout(panFrameRef.current);
    }
    panFrameRef.current = null;
    panFrameKindRef.current = null;
  }

  // Coalesce moves into one repaint per scheduled frame. A synchronous
  // repaint per pointer event would starve the input stream, which makes
  // fast drags choppy and lets them undershoot the cursor.
  function movePan(clientX: number, clientY: number) {
    if (!panDragRef.current) {
      return;
    }
    pendingPanRef.current = { x: clientX, y: clientY };
    if (panFrameRef.current !== null) {
      return;
    }
    const applyPan = () => {
      panFrameRef.current = null;
      panFrameKindRef.current = null;
      const pending = pendingPanRef.current;
      pendingPanRef.current = null;
      const drag = panDragRef.current;
      if (!pending || !drag) {
        return;
      }
      state.panX = drag.panStartX + (pending.x - drag.startX);
      state.panY = drag.panStartY + (pending.y - drag.startY);
      if (panCacheValidRef.current && paintPanCache()) {
        return;
      }
      redrawRef.current();
    };
    panFrameRef.current = schedulePanFrame(applyPan);
  }

  // Snapshot the current frame at reduced resolution. Pan repaints then
  // blit this snapshot instead of re-rendering the whole scene, which is
  // what keeps the pan inside the display frame budget. The snapshot is
  // captured at up to full resolution on standard screens and scaled
  // down only on high-density screens.
  function capturePanCache() {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const cache = panCacheRef.current ?? document.createElement("canvas");
    panCacheRef.current = cache;
    const dpr = state.dpr;
    const cacheScale = Math.min(1, 1.5 / dpr);
    const cacheWidth = Math.max(1, Math.round(canvas.width * cacheScale));
    const cacheHeight = Math.max(1, Math.round(canvas.height * cacheScale));
    if (cache.width !== cacheWidth || cache.height !== cacheHeight) {
      cache.width = cacheWidth;
      cache.height = cacheHeight;
    }
    const context = cache.getContext("2d");
    if (!context) {
      return;
    }
    context.setTransform(cacheScale, 0, 0, cacheScale, 0, 0);
    context.drawImage(canvas, 0, 0);
    panCacheValidRef.current = true;
  }

  // Blit the cached snapshot at the current pan offset and repaint the
  // exposed strips. Returns false when there is no usable cache.
  function paintPanCache(): boolean {
    const canvas = canvasRef.current;
    const cache = panCacheRef.current;
    if (!canvas || !cache) {
      return false;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return false;
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = boardBackground();
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      cache,
      state.panX - panStartRef.current.x,
      state.panY - panStartRef.current.y,
      canvas.width,
      canvas.height,
    );
    return true;
  }

  function endPan() {
    panDragRef.current = null;
    pendingPanRef.current = null;
    cancelPanFrame();
    panningRef.current = false;
    state.interacting = false;
    panCacheValidRef.current = false;
    updateCursor();
    // Repaint at full resolution with the drop shadow restored.
    redrawRef.current();
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
