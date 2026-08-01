import { useState } from "react";
import { GearSix, Sparkle } from "@phosphor-icons/react";
import { ThemeProvider } from "./theme/ThemeContext";
import { ThemeToggle } from "./components/ThemeToggle";
import { SettingsDialog } from "./components/SettingsDialog";
import { FloatingIsland } from "./components/FloatingIsland";
import { PosterResult } from "./components/PosterResult";
import { EditorScreen } from "./components/editor/EditorScreen";
import { MoodboardProvider, useMoodboard } from "./state/MoodboardContext";
import { SettingsProvider } from "./state/SettingsContext";
import { EditorProvider, useEditor } from "./state/EditorContext";
import { createDocumentFromImage } from "./state/posterDocument";
import { errorMessage, generatePoster, type GeneratedPoster } from "./lib/generation";
import "./App.css";

type View = "generate" | "edit";

function Shell() {
  const { references, clearReferences } = useMoodboard();
  const { setDocument } = useEditor();
  const [view, setView] = useState<View>("generate");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GeneratedPoster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  async function handleGenerate(prompt: string) {
    setGenerating(true);
    setError(null);
    try {
      const poster = await generatePoster(prompt, references);
      setResult(poster);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setGenerating(false);
    }
  }

  function handleDismiss() {
    setResult(null);
    clearReferences();
  }

  function handleEdit() {
    if (!result) {
      return;
    }
    setDocument(
      createDocumentFromImage(result.width, result.height, result.dataUrl),
    );
    setView("edit");
  }

  function handleExitEditor() {
    setView("generate");
    setResult(null);
    clearReferences();
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <Sparkle size={22} weight="duotone" className="brand-icon" />
          <span className="brand-name">Literative</span>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="theme-toggle"
            aria-label="Open settings"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <GearSix size={20} weight="regular" />
          </button>
          <ThemeToggle />
        </div>
      </header>
      <main className="canvas-area">
        {view === "edit" ? (
          <EditorScreen onExit={handleExitEditor} />
        ) : (
          <div className="canvas-stack">
            <FloatingIsland busy={generating} onGenerate={handleGenerate} />
            {error && (
              <p className="generation-error" role="alert">
                {error}
              </p>
            )}
            {result && (
              <PosterResult
                poster={result}
                onDismiss={handleDismiss}
                onEdit={handleEdit}
              />
            )}
          </div>
        )}
      </main>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <ThemeProvider>
        <MoodboardProvider>
          <EditorProvider>
            <Shell />
          </EditorProvider>
        </MoodboardProvider>
      </ThemeProvider>
    </SettingsProvider>
  );
}
