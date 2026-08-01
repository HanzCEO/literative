import {
  useEffect,
  useState,
  type ClipboardEvent,
  type FormEvent,
} from "react";
import {
  ArrowUp,
  CircleNotch,
  ImageSquare,
  Plus,
  Sliders,
  X,
} from "@phosphor-icons/react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { useMoodboard } from "../state/MoodboardContext";
import { isImageFile, readReferenceFiles } from "../lib/file";

/** Image extensions the moodboard accepts from a file drop. */
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "avif",
]);

/** Return true when the path ends with an accepted image extension. */
function isImagePath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot !== -1 && IMAGE_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

interface FloatingIslandProps {
  /** Disables the input while a generation runs. */
  busy?: boolean;
  /** Called with the trimmed prompt when the user submits. */
  onGenerate: (prompt: string) => void;
  /** Opens the settings for the active project. */
  onOpenSettings: () => void;
}

export function FloatingIsland({
  busy = false,
  onGenerate,
  onOpenSettings,
}: FloatingIslandProps) {
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

  // The webview cannot read dropped File objects, so the native Tauri
  // drag-drop handler supplies the real file paths for the drop.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    try {
      void getCurrentWebview()
        .onDragDropEvent((event) => {
          const { payload } = event;
          if (payload.type === "enter" || payload.type === "over") {
            setDragActive(true);
            return;
          }
          setDragActive(false);
          if (payload.type === "drop") {
            const paths = payload.paths.filter(isImagePath);
            if (paths.length > 0) {
              void readReferenceFiles(paths)
                .then((files) => addFiles(files))
                .catch(() => undefined);
            }
          }
        })
        .then((stop) => {
          if (disposed) {
            stop();
          } else {
            unlisten = stop;
          }
        });
    } catch {
      // Outside Tauri there is no native drag-drop handler.
    }
    return () => {
      disposed = true;
      unlisten?.();
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

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text && references.length === 0) {
      return;
    }
    onGenerate(text);
  }

  const canSubmit =
    !busy && (prompt.trim().length > 0 || references.length > 0);
  const placeholder =
    references.length === 0
      ? "Drop reference images, then describe your poster..."
      : "Describe your poster...";

  return (
    <div
      className={`island${dragActive ? " island-dragging" : ""}`}
      data-testid="floating-island"
    >
      {references.length > 0 && (
        <div className="moodboard" data-testid="moodboard">
          {references.map((reference) => (
            <div
              key={reference.id}
              className="moodboard-item"
              title={reference.name}
            >
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
          <ImageSquare
            size={22}
            weight="duotone"
            className="island-icon-idle"
          />
          <Plus size={22} weight="bold" className="island-icon-hover" />
        </button>
        <button
          type="button"
          className="island-icon-button"
          aria-label="Generation settings"
          onClick={onOpenSettings}
        >
          <Sliders size={20} weight="duotone" />
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
