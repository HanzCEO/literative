import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { loadImage } from "../lib/file";
import {
  createTextLayer,
  fitInto,
  type Layer,
  type PosterDocument,
} from "./posterDocument";

interface EditorContextValue {
  document: PosterDocument | null;
  selectedId: string | null;
  /** True when the poster sheet itself is selected on the board. */
  sheetSelected: boolean;
  setDocument: React.Dispatch<React.SetStateAction<PosterDocument | null>>;
  selectLayer: (id: string | null) => void;
  /** Select or deselect the poster sheet; selecting clears the layer. */
  selectSheet: (selected: boolean) => void;
  addImageLayer: (
    src: string,
    naturalWidth?: number,
    naturalHeight?: number,
  ) => Promise<void>;
  addTextLayer: () => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  removeLayer: (id: string) => void;
  moveLayer: (id: string, direction: "up" | "down") => void;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [document, setDocument] = useState<PosterDocument | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetSelected, setSheetSelected] = useState(false);

  const selectLayer = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) {
      setSheetSelected(false);
    }
  }, []);

  const selectSheet = useCallback((selected: boolean) => {
    setSheetSelected(selected);
    if (selected) {
      setSelectedId(null);
    }
  }, []);

  const addImageLayer = useCallback(
    async (src: string, naturalWidth?: number, naturalHeight?: number) => {
      let width = naturalWidth;
      let height = naturalHeight;
      if (width === undefined || height === undefined) {
        try {
          const img = await loadImage(src);
          width = img.naturalWidth;
          height = img.naturalHeight;
        } catch {
          width = 512;
          height = 512;
        }
      }
      setDocument((current) => {
        if (!current) {
          return current;
        }
        const fitted = fitInto(width!, height!, current.width, current.height);
        const layer: Layer = {
          id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          kind: "image",
          name: "Image layer",
          visible: true,
          opacity: 1,
          blendMode: "source-over",
          x: Math.round((current.width - fitted.width) / 2),
          y: Math.round((current.height - fitted.height) / 2),
          src,
          width: fitted.width,
          height: fitted.height,
        };
        setSelectedId(layer.id);
        return { ...current, layers: [...current.layers, layer] };
      });
    },
    [],
  );

  const addTextLayer = useCallback(() => {
    setDocument((current) => {
      if (!current) {
        return current;
      }
      const layer = createTextLayer(
        Math.round(current.width * 0.1),
        Math.round(current.height * 0.15),
        current.width,
      );
      setSelectedId(layer.id);
      return { ...current, layers: [...current.layers, layer] };
    });
  }, []);

  const updateLayer = useCallback((id: string, patch: Partial<Layer>) => {
    setDocument((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        layers: current.layers.map((layer) =>
          layer.id === id ? ({ ...layer, ...patch } as Layer) : layer,
        ),
      };
    });
  }, []);

  const removeLayer = useCallback((id: string) => {
    setDocument((current) => {
      if (!current) {
        return current;
      }
      setSelectedId((selected) => (selected === id ? null : selected));
      return {
        ...current,
        layers: current.layers.filter((layer) => layer.id !== id),
      };
    });
  }, []);

  const moveLayer = useCallback((id: string, direction: "up" | "down") => {
    setDocument((current) => {
      if (!current) {
        return current;
      }
      const index = current.layers.findIndex((layer) => layer.id === id);
      if (index < 0) {
        return current;
      }
      const target = direction === "up" ? index + 1 : index - 1;
      if (target < 0 || target >= current.layers.length) {
        return current;
      }
      const layers = [...current.layers];
      [layers[index], layers[target]] = [layers[target], layers[index]];
      return { ...current, layers };
    });
  }, []);

  const value = useMemo(
    () => ({
      document,
      selectedId,
      sheetSelected,
      setDocument,
      selectLayer,
      selectSheet,
      addImageLayer,
      addTextLayer,
      updateLayer,
      removeLayer,
      moveLayer,
    }),
    [
      document,
      selectedId,
      sheetSelected,
      setDocument,
      selectLayer,
      selectSheet,
      addImageLayer,
      addTextLayer,
      updateLayer,
      removeLayer,
      moveLayer,
    ],
  );

  return (
    <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
  );
}

export function useEditor(): EditorContextValue {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error("useEditor must be used within an EditorProvider");
  }
  return context;
}
