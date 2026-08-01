import { useRef, useState, type ChangeEvent } from "react";
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
        <div className="editor-canvas-wrap">
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
          />
        </div>
        <LayerPanel />
      </div>
    </div>
  );
}
