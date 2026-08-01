import { useState, type FormEvent } from "react";
import {
  FileText,
  Files,
  InstagramLogo,
  Monitor,
} from "@phosphor-icons/react";
import {
  DEFAULT_POSTER_SIZE,
  parsePixels,
  POSTER_SIZE_PRESETS,
  sameSize,
  type PosterSize,
  type PosterSizePresetId,
} from "../state/posterSizes";

interface NewProjectPageProps {
  onCancel: () => void;
  onCreate: (input: {
    name: string;
    description: string;
    posterSize: PosterSize;
  }) => void;
}

const PRESET_ICONS: Record<PosterSizePresetId, typeof FileText> = {
  a4: FileText,
  a5: Files,
  screen_16_9: Monitor,
  instagram_portrait: InstagramLogo,
  instagram_square: InstagramLogo,
  instagram_landscape: InstagramLogo,
};

export function NewProjectPage({ onCancel, onCreate }: NewProjectPageProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [width, setWidth] = useState(String(DEFAULT_POSTER_SIZE.width));
  const [height, setHeight] = useState(String(DEFAULT_POSTER_SIZE.height));

  const parsedWidth = parsePixels(width);
  const parsedHeight = parsePixels(height);
  const sizeValid = parsedWidth !== null && parsedHeight !== null;
  const selectedPresetId =
    sizeValid &&
    POSTER_SIZE_PRESETS.find((preset) =>
      sameSize(preset.size, {
        width: parsedWidth,
        height: parsedHeight,
      }),
    )?.id;

  function applyPreset(size: PosterSize) {
    setWidth(String(size.width));
    setHeight(String(size.height));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !sizeValid) {
      return;
    }
    onCreate({
      name,
      description,
      posterSize: { width: parsedWidth, height: parsedHeight },
    });
  }

  return (
    <div className="project-page">
      <div className="project-page-head">
        <div>
          <h1 className="project-title">New project</h1>
          <p className="project-subtitle">
            Give your poster project a name.
          </p>
        </div>
      </div>
      <form className="new-project-form" onSubmit={handleSubmit}>
        <div className="new-project-columns">
          <div className="new-project-column">
            <label className="dialog-field">
              <span className="dialog-label">Name</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="My first poster"
                aria-label="Project name"
                autoFocus
              />
            </label>
            <label className="dialog-field">
              <span className="dialog-label">Description</span>
              <input
                type="text"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional"
                aria-label="Project description"
              />
            </label>
          </div>
          <div className="new-project-column">
            <fieldset className="poster-size-section">
              <legend className="dialog-label">Poster size</legend>
              <div className="dialog-grid">
                <label className="dialog-field">
                  <span className="dialog-label">Width</span>
                  <div className="size-input-wrap">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={width}
                      onChange={(event) => setWidth(event.target.value)}
                      aria-label="Poster width in pixels"
                    />
                    <span className="size-input-unit">px</span>
                  </div>
                </label>
                <label className="dialog-field">
                  <span className="dialog-label">Height</span>
                  <div className="size-input-wrap">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={height}
                      onChange={(event) => setHeight(event.target.value)}
                      aria-label="Poster height in pixels"
                    />
                    <span className="size-input-unit">px</span>
                  </div>
                </label>
              </div>
              {!sizeValid && (
                <p className="dialog-error" role="alert">
                  Width and height must be whole pixels between 1 and 100000.
                </p>
              )}
              <div
                className="poster-preset-grid"
                role="group"
                aria-label="Poster size presets"
              >
                {POSTER_SIZE_PRESETS.map((preset) => {
                  const Icon = PRESET_ICONS[preset.id];
                  const active = preset.id === selectedPresetId;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={
                        active
                          ? "poster-preset-card poster-preset-card-active"
                          : "poster-preset-card"
                      }
                      aria-pressed={active}
                      onClick={() => applyPreset(preset.size)}
                    >
                      <Icon size={20} weight="duotone" />
                      <span className="poster-preset-label">{preset.label}</span>
                      <span className="poster-preset-hint">{preset.hint}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </div>
        </div>
        <div className="dialog-footer">
          <button
            type="button"
            className="dialog-button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="dialog-button dialog-button-primary"
            disabled={!name.trim() || !sizeValid}
          >
            Create project
          </button>
        </div>
      </form>
    </div>
  );
}
