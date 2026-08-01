import {
  useEffect,
  useState,
  type ClipboardEvent,
  type DragEvent as ReactDragEvent,
  type FormEvent,
} from "react";
import { ArrowUp, CircleNotch, ImageSquare, Plus, X } from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { useMoodboard } from "../state/MoodboardContext";
import { isImageFile, readReferenceFiles } from "../lib/file";

interface FloatingIslandProps {
  /** Disables the input while a generation runs. */
  busy?: boolean;
  /** Called with the trimmed prompt when the user submits. */
  onGenerate: (prompt: string) => void;
}

export function FloatingIsland({ busy = false, onGenerate }: FloatingIslandProps) {
  const { references, addFiles, removeReference } = useMoodboard();
  const [prompt, setPrompt] = useState("");
  const [dragActive, setDragActive] = useState(false);

  // Prevent the webview from navigating when files are dragged over the window.
  useEffect(() => {
    function handleWindowDragOver(event: DragEvent) {
      if (event.dataTransfer?.types?.includes("Files")) {
        event.preventDefault();
      }
    }
    function handleWindowDrop(event: DragEvent) {
      if (event.dataTransfer?.types?.includes("Files")) {
        event.preventDefault();
      }
      setDragActive(false);
    }
    window.addEventListener("dragover", handleWindowDragOver);
    window.addEventListener("drop", handleWindowDrop);
    return () => {
      window.removeEventListener("dragover", handleWindowDragOver);
      window.removeEventListener("drop", handleWindowDrop);
    };
  }, []);

  async function handlePickFiles() {
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"],
        },
      ],
    });
    if (!selected) {
      return;
    }
    const paths = Array.isArray(selected) ? selected : [selected];
    const files = await readReferenceFiles(paths);
    await addFiles(files);
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.some(isImageFile)) {
      event.preventDefault();
      void addFiles(files);
    }
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    void addFiles(event.dataTransfer.files);
  }

  function handleDragOver(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    const related = event.relatedTarget as Node | null;
    if (!event.currentTarget.contains(related)) {
      setDragActive(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text && references.length === 0) {
      return;
    }
    onGenerate(text);
  }

  const canSubmit = !busy && (prompt.trim().length > 0 || references.length > 0);
  const placeholder =
    references.length === 0
      ? "Drop reference images, then describe your poster..."
      : "Describe your poster...";

  return (
    <div
      className={`island${dragActive ? " island-dragging" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-testid="floating-island"
    >
      {references.length > 0 && (
        <div className="moodboard" data-testid="moodboard">
          {references.map((reference) => (
            <div key={reference.id} className="moodboard-item" title={reference.name}>
              <img
                src={reference.previewUrl}
                alt={reference.name}
                className="moodboard-thumb"
              />
              <button
                type="button"
                className="moodboard-remove"
                aria-label={`Remove ${reference.name}`}
                onClick={() => removeReference(reference.id)}
              >
                <X size={14} weight="bold" />
              </button>
            </div>
          ))}
        </div>
      )}
      <form className="island-form" onSubmit={handleSubmit}>
        <button
          type="button"
          className="island-icon-button"
          aria-label="Add reference images"
          onClick={() => void handlePickFiles()}
        >
          <ImageSquare size={22} weight="duotone" className="island-icon-idle" />
          <Plus size={22} weight="bold" className="island-icon-hover" />
        </button>
        <input
          className="island-input"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onPaste={handlePaste}
          placeholder={placeholder}
          aria-label="Poster prompt"
          disabled={busy}
        />
        <button
          type="submit"
          className="island-submit"
          aria-label="Generate poster"
          disabled={!canSubmit}
        >
          {busy ? (
            <CircleNotch size={20} weight="bold" className="spin" />
          ) : (
            <ArrowUp size={20} weight="bold" />
          )}
        </button>
      </form>
      {dragActive && (
        <div className="island-drop-hint">
          Drop images to add them to the moodboard
        </div>
      )}
    </div>
  );
}
