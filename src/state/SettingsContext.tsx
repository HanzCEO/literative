import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { defaultSettings, type AppSettings } from "./settingsTypes";

interface SettingsContextValue {
  /** The persisted settings, or null before they load. */
  settings: AppSettings | null;
  /** True after the first load attempt finishes. */
  loaded: boolean;
  error: string | null;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  reload: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const reload = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    try {
      const stored = await invoke<AppSettings | null>("get_app_settings");
      setSettings(stored);
      setError(null);
    } catch (err) {
      setError(
        typeof err === "string" ? err : "Failed to load settings",
      );
    } finally {
      inFlight.current = false;
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const merged: AppSettings = { ...(settings ?? defaultSettings()), ...patch };
      setSettings(merged);
      try {
        await invoke<AppSettings>("save_app_settings", { settings: merged });
        setError(null);
      } catch (err) {
        setError(typeof err === "string" ? err : "Failed to save settings");
      }
    },
    [settings],
  );

  const value = useMemo(
    () => ({ settings, loaded, error, updateSettings, reload }),
    [settings, loaded, error, updateSettings, reload],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}
