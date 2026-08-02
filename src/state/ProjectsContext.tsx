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

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
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
}

const STORAGE_KEY = "literative.projects";
const ACTIVE_KEY = "literative.activeProject";

function normalizeProject(project: Project): Project {
  return {
    ...project,
    posterSize: project.posterSize ?? { ...DEFAULT_POSTER_SIZE },
    settings: project.settings ?? defaultProjectSettings(),
    turnCount: project.turnCount ?? 0,
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
      const project: Project = {
        id: `project-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 7)}`,
        name: input.name.trim(),
        description: (input.description ?? "").trim(),
        createdAt: new Date().toISOString(),
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
  }, []);

  const updateProjectSettings = useCallback(
    (id: string, patch: Partial<ProjectSettings>) => {
      setProjects((previous) =>
        previous.map((project) =>
          project.id === id
            ? {
                ...project,
                settings: { ...project.settings, ...patch },
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
        project.id === id ? { ...project, turnCount: count } : project,
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
    }),
    [
      projects,
      activeProject,
      createProject,
      selectProject,
      removeProject,
      updateProjectSettings,
      setTurnCount,
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
