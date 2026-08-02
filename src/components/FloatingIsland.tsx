import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
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

/** Storage key for the submitted prompt history of a project. */
function promptHistoryKey(projectId: string | null): string {
  return projectId
    ? `literative.project.${projectId}.promptHistory`
    : "literative.promptHistory";
}
/** Cap on how many prompts the history keeps. */
const MAX_PROMPT_HISTORY = 50;

/** Load the persisted prompt history, oldest first. */
function loadPromptHistory(projectId: string | null): string[] {
  try {
    const raw = localStorage.getItem(promptHistoryKey(projectId));
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is string => typeof item === "string")
      .slice(-MAX_PROMPT_HISTORY);
  } catch {
    return [];
  }
}

/** Append a submitted prompt, skipping consecutive duplicates. */
function pushPromptHistory(
  history: string[],
  text: string,
): string[] {
  const next =
    history[history.length - 1] === text
      ? history
      : [...history, text];
  return next.slice(-MAX_PROMPT_HISTORY);
}

interface FloatingIslandProps {
  /** The active project id; its prompt history is used when present. */
  projectId?: string | null;
  /** Disables the input while the agent runs. */
  busy?: boolean;
  /** Called with the trimmed prompt when the user submits. */
  onRun: (prompt: string) => void;
  /** Opens the settings for the active project. */
  onOpenSettings: () => void;
}

export function FloatingIsland({
  projectId = null,
  busy = false,
  onRun,
  onOpenSettings,
}: FloatingIslandProps) {
  const { references, addFiles, removeReference } = useMoodboard();
  const [prompt, setPrompt] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [history, setHistory] = useState<string[]>(() =>
    loadPromptHistory(projectId),
  );
  // Null means the live draft; an index walks the history, oldest first.
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  // The draft saved when the user first steps back into the history.
  const draftRef = useRef("");

  // Reload the history when the active project changes.
  useEffect(() => {
    setHistory(loadPromptHistory(projectId));
    setHistoryIndex(null);
    draftRef.current = "";
    setPrompt("");
  }, [projectId]);

  function stepHistory(direction: "back" | "forward") {
    if (direction === "back") {
      if (history.length === 0) {
        return;
      }
      if (historyIndex === null) {
        draftRef.current = prompt;
        setHistoryIndex(history.length - 1);
        setPrompt(history[history.length - 1]);
        return;
      }
      if (historyIndex > 0) {
        const next = historyIndex - 1;
        setHistoryIndex(next);
        setPrompt(history[next]);
      }
      return;
    }
    if (historyIndex === null) {
      return;
    }
    const next = historyIndex + 1;
    if (next >= history.length) {
      setHistoryIndex(null);
      setPrompt(draftRef.current);
    } else {
      setHistoryIndex(next);
      setPrompt(history[next]);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowUp" && history.length > 0) {
      event.preventDefault();
      stepHistory("back");
    } else if (event.key === "ArrowDown" && historyIndex !== null) {
      event.preventDefault();
      stepHistory("forward");
    }
  }

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
    if (!text) {
      return;
    }
    onRun(text);
    setHistory((current) => {
      const next = pushPromptHistory(current, text);
      try {
        localStorage.setItem(
          promptHistoryKey(projectId),
          JSON.stringify(next),
        );
      } catch {
        // Storage can be unavailable; the session history still works.
      }
      return next;
    });
    setHistoryIndex(null);
    draftRef.current = "";
    setPrompt("");
  }

  const canSubmit = !busy && prompt.trim().length > 0;
  const placeholder =
    references.length === 0
      ? "Describe the poster you want..."
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
          onKeyDown={handleKeyDown}
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
