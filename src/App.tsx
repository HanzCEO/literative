import { useState } from "react";
import { Sparkle } from "@phosphor-icons/react";
import { ThemeProvider } from "./theme/ThemeContext";
import { ThemeToggle } from "./components/ThemeToggle";
import { FloatingIsland } from "./components/FloatingIsland";
import { PosterResult } from "./components/PosterResult";
import { MoodboardProvider, useMoodboard } from "./state/MoodboardContext";
import { errorMessage, generatePoster, type GeneratedPoster } from "./lib/generation";
import "./App.css";

function Shell() {
  const { references, clearReferences } = useMoodboard();
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GeneratedPoster | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <Sparkle size={22} weight="duotone" className="brand-icon" />
          <span className="brand-name">Literative</span>
        </div>
        <ThemeToggle />
      </header>
      <main className="canvas-area">
        <div className="canvas-stack">
          <FloatingIsland busy={generating} onGenerate={handleGenerate} />
          {error && (
            <p className="generation-error" role="alert">
              {error}
            </p>
          )}
          {result && <PosterResult poster={result} onDismiss={handleDismiss} />}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <MoodboardProvider>
        <Shell />
      </MoodboardProvider>
    </ThemeProvider>
  );
}
