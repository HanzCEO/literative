import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { isImageFile } from "../lib/file";

export interface ReferenceImage {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  previewUrl: string;
  file: File;
}

interface MoodboardContextValue {
  references: ReferenceImage[];
  addFiles: (files: FileList | File[]) => Promise<number>;
  removeReference: (id: string) => void;
  clearReferences: () => void;
}

const MoodboardContext = createContext<MoodboardContextValue | null>(null);

export function MoodboardProvider({ children }: { children: ReactNode }) {
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const idCounter = useRef(0);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter(isImageFile);
    const added: ReferenceImage[] = list.map((file) => ({
      id: `ref-${++idCounter.current}`,
      name: file.name,
      mimeType: file.type,
      size: file.size,
      previewUrl: URL.createObjectURL(file),
      file,
    }));
    if (added.length > 0) {
      setReferences((previous) => [...previous, ...added]);
    }
    return added.length;
  }, []);

  const removeReference = useCallback((id: string) => {
    setReferences((previous) => {
      const target = previous.find((reference) => reference.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return previous.filter((reference) => reference.id !== id);
    });
  }, []);

  const clearReferences = useCallback(() => {
    setReferences((previous) => {
      previous.forEach((reference) => URL.revokeObjectURL(reference.previewUrl));
      return [];
    });
  }, []);

  const value = useMemo(
    () => ({ references, addFiles, removeReference, clearReferences }),
    [references, addFiles, removeReference, clearReferences],
  );

  return (
    <MoodboardContext.Provider value={value}>
      {children}
    </MoodboardContext.Provider>
  );
}

export function useMoodboard(): MoodboardContextValue {
  const context = useContext(MoodboardContext);
  if (!context) {
    throw new Error("useMoodboard must be used within a MoodboardProvider");
  }
  return context;
}
