import { X } from "@phosphor-icons/react";
import type { GeneratedPoster } from "../lib/generation";

interface PosterResultProps {
  poster: GeneratedPoster;
  onDismiss: () => void;
}

export function PosterResult({ poster, onDismiss }: PosterResultProps) {
  return (
    <section className="result-card" aria-label="Generated poster">
      <header className="result-header">
        <span className="result-meta">
          {poster.width} x {poster.height} px
        </span>
        <button
          type="button"
          className="result-dismiss"
          aria-label="Dismiss poster"
          onClick={onDismiss}
        >
          <X size={16} weight="bold" />
        </button>
      </header>
      <img
        src={poster.dataUrl}
        alt="Generated poster"
        className="result-image"
      />
    </section>
  );
}
