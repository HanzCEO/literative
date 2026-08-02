import { useEffect, useState, type FormEvent } from "react";
import { GearSix, X } from "@phosphor-icons/react";
import { useSettings } from "../state/SettingsContext";
import { useProjects } from "../state/ProjectsContext";
import {
  defaultGlobalSettings,
  PRESET_PARAMS,
  type CompletionSettings,
  type GenerationParams,
  type GlobalSettings,
  type EndpointTypeKind,
  type PresetKind,
  type ProjectSettings,
} from "../state/settingsTypes";

interface SettingsDialogProps {
  scope: "global" | "project";
  onClose: () => void;
}

export function SettingsDialog({ scope, onClose }: SettingsDialogProps) {
  if (scope === "project") {
    return <ProjectSettingsDialog onClose={onClose} />;
  }
  return <GlobalSettingsDialog onClose={onClose} />;
}

/** The preset selector shared by both settings scopes. */
function PresetField({
  value,
  onChange,
}: {
  value: PresetKind;
  onChange: (preset: PresetKind) => void;
}) {
  return (
    <label className="dialog-field">
      <span className="dialog-label">Preset</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as PresetKind)}
        aria-label="Generation preset"
      >
        <option value="krea_2_turbo">Krea 2 Turbo</option>
        <option value="qwen_image_flash">Qwen Image Flash</option>
      </select>
    </label>
  );
}

/** The generation parameter inputs shared by both settings scopes. */
function GenerationParamsFields({
  params,
  onChange,
}: {
  params: GenerationParams;
  onChange: (patch: Partial<GenerationParams>) => void;
}) {
  return (
    <>
      <div className="dialog-grid">
        <label className="dialog-field">
          <span className="dialog-label">Width</span>
          <input
            type="number"
            min={256}
            max={4096}
            value={params.width}
            onChange={(event) => onChange({ width: Number(event.target.value) })}
            aria-label="Width"
          />
        </label>
        <label className="dialog-field">
          <span className="dialog-label">Height</span>
          <input
            type="number"
            min={256}
            max={4096}
            value={params.height}
            onChange={(event) =>
              onChange({ height: Number(event.target.value) })
            }
            aria-label="Height"
          />
        </label>
        <label className="dialog-field">
          <span className="dialog-label">Steps</span>
          <input
            type="number"
            min={1}
            max={200}
            value={params.steps}
            onChange={(event) => onChange({ steps: Number(event.target.value) })}
            aria-label="Steps"
          />
        </label>
        <label className="dialog-field">
          <span className="dialog-label">Strength</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={params.strength}
            onChange={(event) =>
              onChange({ strength: Number(event.target.value) })
            }
            aria-label="Strength"
          />
        </label>
        <label className="dialog-field">
          <span className="dialog-label">CFG scale</span>
          <input
            type="number"
            min={0}
            max={30}
            step={0.5}
            value={params.cfgScale}
            onChange={(event) =>
              onChange({ cfgScale: Number(event.target.value) })
            }
            aria-label="CFG scale"
          />
        </label>
        <label className="dialog-field">
          <span className="dialog-label">Images per run</span>
          <input
            type="number"
            min={1}
            max={8}
            value={params.n}
            onChange={(event) => onChange({ n: Number(event.target.value) })}
            aria-label="Images per run"
          />
        </label>
      </div>
      <label className="dialog-field">
        <span className="dialog-label">Sampler</span>
        <input
          type="text"
          value={params.sampler}
          onChange={(event) => onChange({ sampler: event.target.value })}
          placeholder="Euler a"
          aria-label="Sampler"
        />
      </label>
      <label className="dialog-field">
        <span className="dialog-label">Negative prompt</span>
        <input
          type="text"
          value={params.negativePrompt}
          onChange={(event) =>
            onChange({ negativePrompt: event.target.value })
          }
          placeholder="Optional"
          aria-label="Negative prompt"
        />
      </label>
    </>
  );
}

function DialogFrame({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Close the dialog when the user presses the Escape key.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Close the dialog when the user clicks the backdrop.
  // Clicks inside the panel keep the dialog open.
  function handleOverlayClick(event: React.MouseEvent) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  return (
    <div
      className="dialog-overlay"
      role="presentation"
      onClick={handleOverlayClick}
    >
      <section
        className="dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="dialog-header">
          <h2 className="dialog-title">
            <GearSix size={18} weight="bold" />
            {title}
          </h2>
          <button
            type="button"
            className="dialog-close"
            aria-label="Close settings"
            onClick={onClose}
          >
            <X size={16} weight="bold" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

/** App-level settings shared by every project. */
function GlobalSettingsDialog({ onClose }: { onClose: () => void }) {
  const { settings, updateSettings } = useSettings();
  const [draft, setDraft] = useState<GlobalSettings>(() => ({
    ...(settings ?? defaultGlobalSettings()),
    params: { ...(settings?.params ?? defaultGlobalSettings().params) },
    completion: {
      ...(settings?.completion ?? defaultGlobalSettings().completion),
    },
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(patch: Partial<GlobalSettings>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function patchCompletion(patch: Partial<CompletionSettings>) {
    setDraft((current) => ({
      ...current,
      completion: { ...current.completion, ...patch },
    }));
  }

  function patchParams(patch: Partial<GlobalSettings["params"]>) {
    setDraft((current) => ({
      ...current,
      params: { ...current.params, ...patch },
    }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateSettings({
        preset: draft.preset,
        endpointType: draft.endpointType,
        endpoint: draft.endpoint.trim(),
        apiKey: draft.apiKey,
        model: draft.model.trim(),
        vsync: draft.vsync,
        maxFps: clampInt(draft.maxFps, 15, 240, 60),
        params: {
          ...draft.params,
          width: clampInt(draft.params.width, 256, 4096, 1024),
          height: clampInt(draft.params.height, 256, 4096, 1024),
          steps: clampInt(draft.params.steps, 1, 200, 8),
          strength: clamp01(draft.params.strength),
          cfgScale: clamp01(draft.params.cfgScale),
          n: clampInt(draft.params.n, 1, 8, 1),
        },
        completion: {
          ...draft.completion,
          baseUrl: draft.completion.baseUrl.trim(),
          model: draft.completion.model.trim(),
        },
      });
      onClose();
    } catch (err) {
      setError(typeof err === "string" ? err : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogFrame title="Settings" onClose={onClose}>
      <form className="dialog-form" onSubmit={handleSubmit} noValidate>
        <div className="dialog-section">
          <h3 className="dialog-section-title">Image API</h3>
          <label className="dialog-field">
            <span className="dialog-label">Endpoint type</span>
            <select
              value={draft.endpointType}
              onChange={(event) =>
                patch({
                  endpointType: event.target.value as EndpointTypeKind,
                })
              }
              aria-label="Endpoint type"
            >
              <option value="stable_diffusion">Stable Diffusion</option>
              <option value="open_ai_compatible">OpenAI Compatible</option>
            </select>
          </label>
          <label className="dialog-field">
            <span className="dialog-label">Endpoint URL</span>
            <input
              type="text"
              value={draft.endpoint}
              onChange={(event) => patch({ endpoint: event.target.value })}
              placeholder="http://127.0.0.1:8000"
              aria-label="Endpoint URL"
            />
          </label>
          <label className="dialog-field">
            <span className="dialog-label">API key</span>
            <input
              type="password"
              value={draft.apiKey}
              onChange={(event) => patch({ apiKey: event.target.value })}
              placeholder="Optional"
              aria-label="API key"
            />
          </label>
          <label className="dialog-field">
            <span className="dialog-label">Model</span>
            <input
              type="text"
              value={draft.model}
              onChange={(event) => patch({ model: event.target.value })}
              placeholder="Optional, for OpenAI compatible APIs"
              aria-label="Model"
            />
          </label>
        </div>
        <div className="dialog-section">
          <h3 className="dialog-section-title">Design agent</h3>
          <p className="dialog-hint">
            The completion model that plans and edits the poster. It is
            separate from the image generation model.
          </p>
          <label className="dialog-field">
            <span className="dialog-label">Completion base URL</span>
            <input
              type="text"
              value={draft.completion.baseUrl}
              onChange={(event) =>
                patchCompletion({ baseUrl: event.target.value })
              }
              placeholder="https://api.openai.com/v1"
              aria-label="Completion base URL"
            />
          </label>
          <label className="dialog-field">
            <span className="dialog-label">Completion API key</span>
            <input
              type="password"
              value={draft.completion.apiKey}
              onChange={(event) =>
                patchCompletion({ apiKey: event.target.value })
              }
              placeholder="Optional"
              aria-label="Completion API key"
            />
          </label>
          <label className="dialog-field">
            <span className="dialog-label">Completion model</span>
            <input
              type="text"
              value={draft.completion.model}
              onChange={(event) =>
                patchCompletion({ model: event.target.value })
              }
              placeholder="Optional, for example gpt-4o"
              aria-label="Completion model"
            />
          </label>
        </div>
        <div className="dialog-section">
          <h3 className="dialog-section-title">Defaults for new projects</h3>
          <p className="dialog-hint">
            New projects start from these values. Each project keeps its own
            copy.
          </p>
          <PresetField
            value={draft.preset}
            onChange={(preset) =>
              patch({
                preset,
                params: { ...PRESET_PARAMS[preset] },
              })
            }
          />
          <GenerationParamsFields params={draft.params} onChange={patchParams} />
        </div>
        <div className="dialog-section">
          <h3 className="dialog-section-title">Performance</h3>
          <p className="dialog-hint">
            Controls how often the drawing board repaints while you pan.
          </p>
          <label className="dialog-field dialog-field-row">
            <span className="dialog-label">V Sync</span>
            <input
              type="checkbox"
              checked={draft.vsync}
              onChange={(event) => patch({ vsync: event.target.checked })}
              aria-label="V Sync"
            />
          </label>
          <label className="dialog-field">
            <span className="dialog-label">Max FPS</span>
            <input
              type="number"
              min={15}
              max={240}
              value={draft.maxFps}
              disabled={draft.vsync}
              onChange={(event) =>
                patch({ maxFps: Number(event.target.value) })
              }
              aria-label="Max FPS"
            />
            {draft.vsync && (
              <p className="dialog-hint">
                Off while V Sync is on: repaints follow the display refresh
                rate.
              </p>
            )}
          </label>
        </div>
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <footer className="dialog-footer">
          <button type="button" className="dialog-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="dialog-button dialog-button-primary"
            disabled={saving}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </footer>
      </form>
    </DialogFrame>
  );
}

/** Generation settings stored on the active project. */
function ProjectSettingsDialog({ onClose }: { onClose: () => void }) {
  const { activeProject, updateProjectSettings } = useProjects();
  const [draft, setDraft] = useState<ProjectSettings | null>(() =>
    activeProject
      ? {
          ...activeProject.settings,
          params: { ...activeProject.settings.params },
        }
      : null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!activeProject || !draft) {
    return null;
  }

  function patch(patch: Partial<ProjectSettings>) {
    setDraft((current) =>
      current ? { ...current, ...patch } : current,
    );
  }

  function patchParams(patch: Partial<GenerationParams>) {
    setDraft((current) =>
      current
        ? { ...current, params: { ...current.params, ...patch } }
        : current,
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!activeProject || !draft) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      updateProjectSettings(activeProject.id, {
        preset: draft.preset,
        params: {
          ...draft.params,
          width: clampInt(draft.params.width, 256, 4096, 1024),
          height: clampInt(draft.params.height, 256, 4096, 1024),
          steps: clampInt(draft.params.steps, 1, 200, 8),
          strength: clamp01(draft.params.strength),
          cfgScale: clamp01(draft.params.cfgScale),
          n: clampInt(draft.params.n, 1, 8, 1),
        },
      });
      onClose();
    } catch (err) {
      setError(typeof err === "string" ? err : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogFrame title="Project settings" onClose={onClose}>
      <form className="dialog-form" onSubmit={handleSubmit} noValidate>
        <div className="dialog-section">
          <h3 className="dialog-section-title">Generation parameters</h3>
          <p className="dialog-hint">{activeProject.name}</p>
          <PresetField
            value={draft.preset}
            onChange={(preset) =>
              patch({
                preset,
                params: { ...PRESET_PARAMS[preset] },
              })
            }
          />
          <GenerationParamsFields params={draft.params} onChange={patchParams} />
        </div>
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <footer className="dialog-footer">
          <button type="button" className="dialog-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="dialog-button dialog-button-primary"
            disabled={saving}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </footer>
      </form>
    </DialogFrame>
  );
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(1, Math.max(0, value));
}
