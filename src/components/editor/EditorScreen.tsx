import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  Check,
  FileImage,
  FilePlus,
  FileX,
  TextT,
} from "@phosphor-icons/react";
import { useEditor } from "../../state/EditorContext";
import { PosterCanvas } from "./PosterCanvas";
import { LayerPanel } from "./LayerPanel";
import { errorMessage } from "../../lib/generation";
import { exportPoster } from "../../lib/export";

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const CANVAS_PADDING = 24;

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

interface EditorScreenProps {
  onExit: () => void;
}

export function EditorScreen({ onExit }: EditorScreenProps) {
  const {
    document,
    selectedId,
    selectLayer,
    addImageLayer,
    addTextLayer,
    updateLayer,
    setDocument,
  } = useEditor();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fitScale, setFitScale] = useState(0.1);
  const zoomRef = useRef(1);
  const fitScaleRef = useRef(0.1);
  const sizeRef = useRef({ width: 1, height: 1 });

  const applyZoom = useCallback((next: number) => {
    const clamped = clampZoom(next);
    zoomRef.current = clamped;
    setZoom(clamped);
  }, []);

  // Zoom toward the anchor point, or toward the wrap center.
  const zoomAt = useCallback(
    (factor: number, anchor?: { clientX: number; clientY: number }) => {
      const wrap = wrapRef.current;
      if (!wrap) {
        return;
      }
      const oldZoom = zoomRef.current;
      const next = clampZoom(oldZoom * factor);
      if (next === oldZoom) {
        return;
      }
      const size = sizeRef.current;
      const fit = fitScaleRef.current;
      const oldWidth = size.width * fit * oldZoom;
      const oldHeight = size.height * fit * oldZoom;
      const newWidth = oldWidth * (next / oldZoom);
      const newHeight = oldHeight * (next / oldZoom);
      const rect = wrap.getBoundingClientRect();
      const anchorX = anchor
        ? anchor.clientX - rect.left
        : wrap.clientWidth / 2;
      const anchorY = anchor
        ? anchor.clientY - rect.top
        : wrap.clientHeight / 2;
      const oldMarginX = Math.max(0, wrap.clientWidth - oldWidth) / 2;
      const oldMarginY = Math.max(0, wrap.clientHeight - oldHeight) / 2;
      const contentX = wrap.scrollLeft + anchorX - oldMarginX;
      const contentY = wrap.scrollTop + anchorY - oldMarginY;
      const ratio = next / oldZoom;
      zoomRef.current = next;
      setZoom(next);
      // Adjust the scroll after the new size renders, so the point
      // under the cursor stays fixed.
      requestAnimationFrame(() => {
        const newMarginX = Math.max(0, wrap.clientWidth - newWidth) / 2;
        const newMarginY = Math.max(0, wrap.clientHeight - newHeight) / 2;
        wrap.scrollLeft = contentX * ratio - anchorX + newMarginX;
        wrap.scrollTop = contentY * ratio - anchorY + newMarginY;
      });
    },
    [],
  );

  // Measure the fit scale whenever the wrap or the poster size changes.
  useEffect(() => {
    if (!document) {
      return;
    }
    sizeRef.current = { width: document.width, height: document.height };
    const wrap = wrapRef.current;
    if (!wrap) {
      return;
    }
    const measure = () => {
      const availableWidth = Math.max(
        wrap.clientWidth - CANVAS_PADDING * 2,
        1,
      );
      const availableHeight = Math.max(
        wrap.clientHeight - CANVAS_PADDING * 2,
        1,
      );
      const scale = Math.min(
        availableWidth / document.width,
        availableHeight / document.height,
      );
      const next = Math.max(scale, 0.01);
      fitScaleRef.current = next;
      setFitScale(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [document?.width, document?.height]);

  // Ctrl or Cmd plus wheel zooms toward the cursor.
  // A plain wheel scroll keeps scrolling the wrap.
  useEffect(() => {
    if (!document) {
      return;
    }
    const wrap = wrapRef.current;
    if (!wrap) {
      return;
    }
    function handleWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0012);
      zoomAt(factor, { clientX: event.clientX, clientY: event.clientY });
    }
    wrap.addEventListener("wheel", handleWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", handleWheel);
  }, [document?.width, document?.height, zoomAt]);

  // Ctrl or Cmd plus Plus, Minus, or 0 zooms the canvas.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomAt(1.25);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomAt(0.8);
      } else if (event.key === "0") {
        event.preventDefault();
        applyZoom(1);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [zoomAt, applyZoom]);

  if (!document) {
    return null;
  }

  const current = document;

  async function handleImageFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !file.type.startsWith("image/")) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      void addImageLayer(reader.result as string);
    };
    reader.readAsDataURL(file);
  }

  async function handleExport(format: "png" | "jpeg") {
    setBusy(true);
    setMessage(null);
    try {
      const result = await exportPoster(current, format);
      if (result) {
        setMessage(`Exported to ${result.path}`);
      }
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function handleBlank() {
    setDocument({
      width: current.width,
      height: current.height,
      layers: [],
    });
    selectLayer(null);
  }

  return (
    <div className="editor-screen">
      <header className="editor-toolbar">
        <div className="editor-toolbar-left">
          <span className="editor-size">
            {document.width} x {document.height} px
          </span>
          <span
            className="editor-zoom"
            aria-label="Zoom level"
            title="Ctrl + scroll to zoom"
          >
            Zoom {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            className="toolbar-button"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileImage size={16} weight="bold" />
            Add image
          </button>
          <button type="button" className="toolbar-button" onClick={addTextLayer}>
            <TextT size={16} weight="bold" />
            Add text
          </button>
          <button type="button" className="toolbar-button" onClick={handleBlank}>
            <FilePlus size={16} weight="bold" />
            Blank
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={handleImageFile}
            aria-label="Add image layer"
          />
        </div>
        <div className="editor-toolbar-right">
          <button
            type="button"
            className="toolbar-button"
            disabled={busy}
            onClick={() => void handleExport("png")}
          >
            <FileX size={16} weight="bold" />
            Export PNG
          </button>
          <button
            type="button"
            className="toolbar-button"
            disabled={busy}
            onClick={() => void handleExport("jpeg")}
          >
            <FileX size={16} weight="bold" />
            Export JPG
          </button>
          <button
            type="button"
            className="toolbar-button toolbar-button-primary"
            onClick={onExit}
          >
            <Check size={16} weight="bold" />
            Done
          </button>
        </div>
      </header>
      {message && (
        <p className="editor-message" role="status">
          {message}
        </p>
      )}
      <div className="editor-body">
        <div className="editor-canvas-wrap" ref={wrapRef}>
          {document.layers.length === 0 && (
            <p className="editor-empty-hint">
              Your poster is blank. Add an image or text layer.
            </p>
          )}
          <PosterCanvas
            document={document}
            selectedId={selectedId}
            onSelect={selectLayer}
            onMoveLayer={(id, x, y) => updateLayer(id, { x, y })}
            displayWidth={Math.round(document.width * fitScale * zoom)}
            displayHeight={Math.round(document.height * fitScale * zoom)}
          />
        </div>
        <LayerPanel />
      </div>
    </div>
  );
}
