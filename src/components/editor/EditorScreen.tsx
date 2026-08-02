import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from "react";
import {
  Check,
  FileImage,
  FilePlus,
  FileX,
  Minus,
  Plus,
  TextT,
} from "@phosphor-icons/react";
import { useEditor } from "../../state/EditorContext";
import { PosterCanvas, type PosterBoardHandle } from "./PosterCanvas";
import { LayerPanel } from "./LayerPanel";
import { errorMessage } from "../../lib/generation";
import { exportPoster } from "../../lib/export";

interface EditorScreenProps {
  /** The shared drawing board canvas (canvas-area). */
  boardRef: RefObject<HTMLCanvasElement | null>;
  onExit: () => void;
}

/**
 * The poster editor chrome. The drawing board canvas lives at the app
 * level; this component floats its toolbar and layer panel above it.
 */
export function EditorScreen({ boardRef, onExit }: EditorScreenProps) {
  const {
    document,
    selectedId,
    sheetSelected,
    selectLayer,
    selectSheet,
    addImageLayer,
    addTextLayer,
    updateLayer,
    setDocument,
  } = useEditor();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const posterRef = useRef<PosterBoardHandle | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  // Plus, Minus, or 0 zooms the canvas with or without Ctrl or Cmd. The
  // plain keys work even where the webview eats the Ctrl combos, so zoom
  // never depends on a modifier reaching the DOM. Keys typed into layer
  // controls are left alone.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const code = event.code;
      const key = event.key;
      const zoomIn =
        code === "Equal" ||
        code === "NumpadAdd" ||
        key === "+" ||
        key === "=";
      const zoomOut =
        code === "Minus" ||
        code === "NumpadSubtract" ||
        key === "-" ||
        key === "_";
      const reset =
        code === "Digit0" || code === "Numpad0" || key === "0";
      if (!zoomIn && !zoomOut && !reset) {
        return;
      }
      const modifier = event.ctrlKey || event.metaKey;
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (typing && !modifier) {
        return;
      }
      event.preventDefault();
      if (zoomIn) {
        posterRef.current?.zoomBy(1.25);
      } else if (zoomOut) {
        posterRef.current?.zoomBy(0.8);
      } else {
        posterRef.current?.resetZoom();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
      sheetX: 0,
      sheetY: 0,
    });
    selectLayer(null);
    selectSheet(false);
  }

  return (
    <>
      <PosterCanvas
        ref={posterRef}
        canvasRef={boardRef}
        document={document}
        selectedId={selectedId}
        sheetSelected={sheetSelected}
        onSelect={selectLayer}
        onSheetSelect={selectSheet}
        onMoveLayer={(id, x, y) => updateLayer(id, { x, y })}
        onSheetMove={(x, y) =>
          setDocument((current) =>
            current
              ? {
                  ...current,
                  sheetX: Math.round(x),
                  sheetY: Math.round(y),
                }
              : current,
          )
        }
        onZoomChange={setZoom}
      />
      {document.layers.length === 0 && (
        <p className="editor-empty-hint">
          Your poster is blank. Add an image or text layer.
        </p>
      )}
      <header className="editor-toolbar">
        <div className="editor-toolbar-left">
          <button
            type="button"
            className="toolbar-button"
            aria-label="Zoom out"
            onClick={() => posterRef.current?.zoomBy(0.8)}
          >
            <Minus size={16} weight="bold" />
          </button>
          <button
            type="button"
            className="toolbar-button"
            aria-label="Zoom in"
            onClick={() => posterRef.current?.zoomBy(1.25)}
          >
            <Plus size={16} weight="bold" />
          </button>
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
        <div className="editor-toolbar-center">
          <span
            className="editor-zoom"
            aria-label="Zoom level"
            title="Scroll to zoom"
          >
            Zoom {Math.round(zoom * 100)}%
          </span>
          <span className="editor-zoom-divider" aria-hidden="true" />
          <span className="editor-size">
            {document.width} x {document.height} px
          </span>
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
      <LayerPanel />
      {message && (
        <p className="editor-message" role="status">
          {message}
        </p>
      )}
    </>
  );
}
