import { PencilSimple, X } from "@phosphor-icons/react";
import type { GeneratedPoster } from "../lib/generation";

interface PosterResultProps {
  poster: GeneratedPoster;
  onDismiss: () => void;
  onEdit: () => void;
}

export function PosterResult({ poster, onDismiss, onEdit }: PosterResultProps) {
  return (
    <section className="result-card" aria-label="Generated poster">
      <header className="result-header">
        <span className="result-meta">
          {poster.width} x {poster.height} px
        </span>
        <div className="result-actions">
          <button
            type="button"
            className="result-button"
            onClick={onEdit}
            aria-label="Edit poster"
          >
            <PencilSimple size={16} weight="bold" />
            Edit
          </button>
          <button
            type="button"
            className="result-dismiss"
            aria-label="Dismiss poster"
            onClick={onDismiss}
          >
            <X size={16} weight="bold" />
          </button>
        </div>
      </header>
      <img
        src={poster.dataUrl}
        alt="Generated poster"
        className="result-image"
      />
    </section>
  );
}
