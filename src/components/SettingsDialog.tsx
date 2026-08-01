import { useState, type FormEvent } from "react";
import { GearSix, X } from "@phosphor-icons/react";
import { useSettings } from "../state/SettingsContext";
import {
  defaultSettings,
  PRESET_PARAMS,
  type AppSettings,
  type EndpointTypeKind,
  type PresetKind,
} from "../state/settingsTypes";

interface SettingsDialogProps {
  onClose: () => void;
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const { settings, updateSettings } = useSettings();
  const [draft, setDraft] = useState<AppSettings>(() => ({
    ...(settings ?? defaultSettings()),
    params: { ...(settings?.params ?? defaultSettings().params) },
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(patch: Partial<AppSettings>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function patchParams(patch: Partial<AppSettings["params"]>) {
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
        params: {
          ...draft.params,
          width: clampInt(draft.params.width, 256, 4096, 1024),
          height: clampInt(draft.params.height, 256, 4096, 1536),
          steps: clampInt(draft.params.steps, 1, 200, 30),
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
    <div className="dialog-overlay" role="presentation">
      <section
        className="dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <header className="dialog-header">
          <h2 className="dialog-title">
            <GearSix size={18} weight="bold" />
            Settings
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
        <form className="dialog-form" onSubmit={handleSubmit} noValidate>
          <div className="dialog-section">
            <h3 className="dialog-section-title">Image API</h3>
            <label className="dialog-field">
              <span className="dialog-label">Preset</span>
              <select
                value={draft.preset}
                onChange={(event) => {
                  const preset = event.target.value as PresetKind;
                  patch({
                    preset,
                    params: { ...PRESET_PARAMS[preset] },
                  });
                }}
                aria-label="Generation preset"
              >
                <option value="krea_2_turbo">Krea 2 Turbo</option>
                <option value="qwen_image_flash">Qwen Image Flash</option>
              </select>
            </label>
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
            <h3 className="dialog-section-title">Generation parameters</h3>
            <div className="dialog-grid">
              <label className="dialog-field">
                <span className="dialog-label">Width</span>
                <input
                  type="number"
                  min={256}
                  max={4096}
                  value={draft.params.width}
                  onChange={(event) =>
                    patchParams({ width: Number(event.target.value) })
                  }
                  aria-label="Width"
                />
              </label>
              <label className="dialog-field">
                <span className="dialog-label">Height</span>
                <input
                  type="number"
                  min={256}
                  max={4096}
                  value={draft.params.height}
                  onChange={(event) =>
                    patchParams({ height: Number(event.target.value) })
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
                  value={draft.params.steps}
                  onChange={(event) =>
                    patchParams({ steps: Number(event.target.value) })
                  }
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
                  value={draft.params.strength}
                  onChange={(event) =>
                    patchParams({ strength: Number(event.target.value) })
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
                  value={draft.params.cfgScale}
                  onChange={(event) =>
                    patchParams({ cfgScale: Number(event.target.value) })
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
                  value={draft.params.n}
                  onChange={(event) =>
                    patchParams({ n: Number(event.target.value) })
                  }
                  aria-label="Images per run"
                />
              </label>
            </div>
            <label className="dialog-field">
              <span className="dialog-label">Sampler</span>
              <input
                type="text"
                value={draft.params.sampler}
                onChange={(event) =>
                  patchParams({ sampler: event.target.value })
                }
                placeholder="Euler a"
                aria-label="Sampler"
              />
            </label>
            <label className="dialog-field">
              <span className="dialog-label">Negative prompt</span>
              <input
                type="text"
                value={draft.params.negativePrompt}
                onChange={(event) =>
                  patchParams({ negativePrompt: event.target.value })
                }
                placeholder="Optional"
                aria-label="Negative prompt"
              />
            </label>
          </div>
          {error && (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          )}
          <footer className="dialog-footer">
            <button
              type="button"
              className="dialog-button"
              onClick={onClose}
            >
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
      </section>
    </div>
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
