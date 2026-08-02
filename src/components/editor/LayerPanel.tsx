import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeSlash,
  Shapes,
  TextT,
  Trash,
} from "@phosphor-icons/react";
import { useEditor } from "../../state/EditorContext";
import {
  BLEND_MODES,
  type Layer,
  type TextLayer,
} from "../../state/posterDocument";

export function LayerPanel() {
  const {
    document,
    selectedId,
    selectLayer,
    updateLayer,
    removeLayer,
    moveLayer,
  } = useEditor();
  if (!document) {
    return null;
  }

  const layersTopFirst = [...document.layers].reverse();
  const selected = document.layers.find((layer) => layer.id === selectedId) ?? null;

  return (
    <aside className="layer-panel" aria-label="Layer panel">
      <h2 className="layer-panel-title">Layers</h2>
      <ul className="layer-list">
        {layersTopFirst.map((layer) => (
          <li key={layer.id} className="layer-row-wrap">
            <div
              className={`layer-row${layer.id === selectedId ? " layer-row-selected" : ""}`}
              onClick={() =>
                selectLayer(layer.id === selectedId ? null : layer.id)
              }
              data-testid={`layer-row-${layer.id}`}
            >
              <span className="layer-kind">
                {layer.kind === "image" ? (
                  <img src={layer.src} alt="" className="layer-kind-thumb" />
                ) : layer.kind === "shape" ? (
                  <Shapes size={14} weight="bold" />
                ) : (
                  <TextT size={14} weight="bold" />
                )}
              </span>
              <span className="layer-name">{layer.name}</span>
              <button
                type="button"
                className="layer-icon-button"
                aria-label={`Toggle visibility of ${layer.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  updateLayer(layer.id, { visible: !layer.visible });
                }}
              >
                {layer.visible ? (
                  <Eye size={16} weight="regular" />
                ) : (
                  <EyeSlash size={16} weight="regular" />
                )}
              </button>
            </div>
            <div className="layer-row-actions">
              <button
                type="button"
                className="layer-icon-button"
                aria-label={`Move ${layer.name} up`}
                disabled={layer.id === document.layers[document.layers.length - 1].id}
                onClick={() => moveLayer(layer.id, "up")}
              >
                <ArrowUp size={14} weight="bold" />
              </button>
              <button
                type="button"
                className="layer-icon-button"
                aria-label={`Move ${layer.name} down`}
                disabled={layer.id === document.layers[0].id}
                onClick={() => moveLayer(layer.id, "down")}
              >
                <ArrowDown size={14} weight="bold" />
              </button>
              <button
                type="button"
                className="layer-icon-button layer-delete"
                aria-label={`Delete ${layer.name}`}
                onClick={() => removeLayer(layer.id)}
              >
                <Trash size={14} weight="bold" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {document.layers.length === 0 && (
        <p className="layer-empty">No layers yet. Add an image or text.</p>
      )}
      {selected && <LayerProperties layer={selected} />}
    </aside>
  );
}

function LayerProperties({ layer }: { layer: Layer }) {
  const { updateLayer } = useEditor();

  return (
    <div className="layer-properties" data-testid="layer-properties">
      <h3 className="layer-properties-title">Properties</h3>
      <label className="property-field">
        <span className="property-label">Opacity</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(layer.opacity * 100)}
          onChange={(event) =>
            updateLayer(layer.id, { opacity: Number(event.target.value) / 100 })
          }
          aria-label="Layer opacity"
        />
      </label>
      <label className="property-field">
        <span className="property-label">Blend mode</span>
        <select
          value={layer.blendMode}
          onChange={(event) =>
            updateLayer(layer.id, {
              blendMode: event.target.value as Layer["blendMode"],
            })
          }
          aria-label="Blend mode"
        >
          {BLEND_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </label>
      {layer.kind === "text" && <TextProperties layer={layer} />}
    </div>
  );
}

function TextProperties({ layer }: { layer: TextLayer }) {
  const { updateLayer } = useEditor();
  return (
    <>
      <label className="property-field">
        <span className="property-label">Text</span>
        <input
          type="text"
          value={layer.text}
          onChange={(event) =>
            updateLayer(layer.id, { text: event.target.value })
          }
          aria-label="Layer text"
        />
      </label>
      <label className="property-field">
        <span className="property-label">Font size</span>
        <input
          type="number"
          min={8}
          max={512}
          value={layer.fontSize}
          onChange={(event) =>
            updateLayer(layer.id, { fontSize: Number(event.target.value) || 24 })
          }
          aria-label="Font size"
        />
      </label>
      <label className="property-field">
        <span className="property-label">Color</span>
        <input
          type="color"
          value={hexToColorInput(layer.color)}
          onChange={(event) =>
            updateLayer(layer.id, { color: `${event.target.value}ff` })
          }
          aria-label="Text color"
        />
      </label>
    </>
  );
}

function hexToColorInput(color: string): string {
  return color.startsWith("#") ? color.slice(0, 7) : "#000000";
}
