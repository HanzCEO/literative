import { Sparkle } from "@phosphor-icons/react";
import { ThemeProvider } from "./theme/ThemeContext";
import { ThemeToggle } from "./components/ThemeToggle";
import { FloatingIsland } from "./components/FloatingIsland";
import { MoodboardProvider } from "./state/MoodboardContext";
import "./App.css";

function Shell() {
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
        <FloatingIsland onGenerate={() => {}} />
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
