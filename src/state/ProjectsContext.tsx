import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_POSTER_SIZE,
  type PosterSize,
} from "./posterSizes";
import {
  defaultProjectSettings,
  type ProjectSettings,
} from "./settingsTypes";
import type { PosterDocument } from "./posterDocument";

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  /** When the project content last changed; orders the project list. */
  updatedAt: string;
  posterSize: PosterSize;
  settings: ProjectSettings;
  /** How many agent turns this project has completed. */
  turnCount: number;
}

interface ProjectsContextValue {
  projects: Project[];
  activeProject: Project | null;
  createProject: (input: {
    name: string;
    description?: string;
    posterSize?: PosterSize;
    settings?: ProjectSettings;
  }) => Project;
  selectProject: (id: string) => void;
  removeProject: (id: string) => void;
  updateProjectSettings: (
    id: string,
    patch: Partial<ProjectSettings>,
  ) => void;
  /** Record how many agent turns a project has completed. */
  setTurnCount: (id: string, count: number) => void;
  /** Persist the poster document for a project; null clears it. */
  updateProjectDocument: (id: string, document: PosterDocument | null) => void;
  /** Load the persisted poster document for a project, or null. */
  getProjectDocument: (id: string) => PosterDocument | null;
}

const STORAGE_KEY = "literative.projects";
const ACTIVE_KEY = "literative.activeProject";

/** Per-project document storage key; the list stays separate and small. */
function documentKey(id: string): string {
  return `literative.project.${id}.document`;
}

function saveProjectDocument(id: string, document: PosterDocument | null): void {
  try {
    if (document) {
      localStorage.setItem(documentKey(id), JSON.stringify(document));
    } else {
      localStorage.removeItem(documentKey(id));
    }
  } catch {
    // Storage can be unavailable or full; the session keeps working.
  }
}

function loadProjectDocument(id: string): PosterDocument | null {
  try {
    const raw = localStorage.getItem(documentKey(id));
    return raw ? (JSON.parse(raw) as PosterDocument) : null;
  } catch {
    return null;
  }
}

function normalizeProject(project: Project): Project {
  return {
    ...project,
    posterSize: project.posterSize ?? { ...DEFAULT_POSTER_SIZE },
    settings: project.settings ?? defaultProjectSettings(),
    turnCount: project.turnCount ?? 0,
    updatedAt: project.updatedAt ?? project.createdAt,
  };
}

function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed as Project[]).map(normalizeProject)
      : [];
  } catch {
    return [];
  }
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>(loadProjects);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() =>
    localStorage.getItem(ACTIVE_KEY),
  );
  const activeProject =
    projects.find((project) => project.id === activeProjectId) ?? null;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    } catch {
      // Storage can be unavailable; the session keeps working.
    }
  }, [projects]);

  useEffect(() => {
    if (activeProjectId) {
      try {
        localStorage.setItem(ACTIVE_KEY, activeProjectId);
      } catch {
        // Storage can be unavailable; the session keeps working.
      }
    }
  }, [activeProjectId]);

  const createProject = useCallback(
    (input: {
      name: string;
      description?: string;
      posterSize?: PosterSize;
      settings?: ProjectSettings;
    }): Project => {
      const now = new Date().toISOString();
      const project: Project = {
        id: `project-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 7)}`,
        name: input.name.trim(),
        description: (input.description ?? "").trim(),
        createdAt: now,
        updatedAt: now,
        posterSize: input.posterSize ?? { ...DEFAULT_POSTER_SIZE },
        settings: input.settings ?? defaultProjectSettings(),
        turnCount: 0,
      };
      setProjects((previous) => [...previous, project]);
      return project;
    },
    [],
  );

  const selectProject = useCallback((id: string) => {
    setActiveProjectId(id);
  }, []);

  const removeProject = useCallback((id: string) => {
    setProjects((previous) =>
      previous.filter((project) => project.id !== id),
    );
    setActiveProjectId((current) => (current === id ? null : current));
    saveProjectDocument(id, null);
  }, []);

  const updateProjectDocument = useCallback(
    (id: string, document: PosterDocument | null) => {
      saveProjectDocument(id, document);
    },
    [],
  );

  const getProjectDocument = useCallback((id: string) => {
    return loadProjectDocument(id);
  }, []);

  const updateProjectSettings = useCallback(
    (id: string, patch: Partial<ProjectSettings>) => {
      setProjects((previous) =>
        previous.map((project) =>
          project.id === id
            ? {
                ...project,
                settings: { ...project.settings, ...patch },
                updatedAt: new Date().toISOString(),
              }
            : project,
        ),
      );
    },
    [],
  );

  const setTurnCount = useCallback((id: string, count: number) => {
    setProjects((previous) =>
      previous.map((project) =>
        project.id === id
          ? { ...project, turnCount: count, updatedAt: new Date().toISOString() }
          : project,
      ),
    );
  }, []);

  const value = useMemo(
    () => ({
      projects,
      activeProject,
      createProject,
      selectProject,
      removeProject,
      updateProjectSettings,
      setTurnCount,
      updateProjectDocument,
      getProjectDocument,
    }),
    [
      projects,
      activeProject,
      createProject,
      selectProject,
      removeProject,
      updateProjectSettings,
      setTurnCount,
      updateProjectDocument,
      getProjectDocument,
    ],
  );

  return (
    <ProjectsContext.Provider value={value}>
      {children}
    </ProjectsContext.Provider>
  );
}

export function useProjects(): ProjectsContextValue {
  const context = useContext(ProjectsContext);
  if (!context) {
    throw new Error("useProjects must be used within a ProjectsProvider");
  }
  return context;
}
