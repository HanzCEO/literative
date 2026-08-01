import { useState } from "react";
import { Cactus, GearSix } from "@phosphor-icons/react";
import { ThemeProvider } from "./theme/ThemeContext";
import { ThemeToggle } from "./components/ThemeToggle";
import { SettingsDialog } from "./components/SettingsDialog";
import { FloatingIsland } from "./components/FloatingIsland";
import { PosterResult } from "./components/PosterResult";
import { PosterFrame } from "./components/PosterFrame";
import { EditorScreen } from "./components/editor/EditorScreen";
import { ProjectListPage } from "./components/ProjectListPage";
import { NewProjectPage } from "./components/NewProjectPage";
import { MoodboardProvider, useMoodboard } from "./state/MoodboardContext";
import { SettingsProvider, useSettings } from "./state/SettingsContext";
import { EditorProvider, useEditor } from "./state/EditorContext";
import { ProjectsProvider, useProjects } from "./state/ProjectsContext";
import { createDocumentFromImage, createDocumentWithImage } from "./state/posterDocument";
import { errorMessage, generatePoster, type GeneratedPoster } from "./lib/generation";
import { defaultProjectSettings } from "./state/settingsTypes";
import "./App.css";

type View = "projects" | "newProject" | "editor" | "poster";

function Shell() {
  const { references, clearReferences } = useMoodboard();
  const { setDocument } = useEditor();
  const { activeProject, createProject, selectProject } = useProjects();
  const { settings: globalSettings } = useSettings();
  const [view, setView] = useState<View>("projects");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GeneratedPoster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [backHovered, setBackHovered] = useState(false);

  function resetGeneration() {
    setResult(null);
    setError(null);
    clearReferences();
  }

  function handleCreateProject(input: {
    name: string;
    description: string;
    posterSize: { width: number; height: number };
  }) {
    const project = createProject({
      ...input,
      settings: globalSettings
        ? {
            preset: globalSettings.preset,
            params: { ...globalSettings.params },
          }
        : undefined,
    });
    selectProject(project.id);
    resetGeneration();
    setView("editor");
  }

  function handleOpenProject(projectId: string) {
    selectProject(projectId);
    resetGeneration();
    setView("editor");
  }

  async function handleGenerate(prompt: string) {
    setGenerating(true);
    setError(null);
    try {
      const params =
        activeProject?.settings.params ?? defaultProjectSettings().params;
      const poster = await generatePoster(prompt, references, params);
      setResult(poster);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setGenerating(false);
    }
  }

  function handleDismiss() {
    setResult(null);
    clearReferences();
  }

  function handleEdit() {
    if (!result) {
      return;
    }
    const size = activeProject?.posterSize;
    if (size) {
      setDocument(
        createDocumentWithImage(
          size.width,
          size.height,
          result.width,
          result.height,
          result.dataUrl,
        ),
      );
    } else {
      setDocument(
        createDocumentFromImage(result.width, result.height, result.dataUrl),
      );
    }
    setView("poster");
  }

  function handleExitEditor() {
    setView("editor");
    resetGeneration();
  }

  const inEditor = view === "editor" || view === "poster";

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          {inEditor && (
            <button
              type="button"
              className="header-back"
              aria-label="Back to projects"
              title="Projects"
              onClick={() => setView("projects")}
              onMouseEnter={() => setBackHovered(true)}
              onMouseLeave={() => setBackHovered(false)}
            >
              <Cactus
                size={18}
                weight={backHovered ? "fill" : "regular"}
              />
            </button>
          )}
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="theme-toggle"
            aria-label="Open settings"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <GearSix size={20} weight="regular" />
          </button>
          <ThemeToggle />
        </div>
      </header>
      <main className="canvas-area">
        {view === "projects" && (
          <ProjectListPage
            onNewProject={() => setView("newProject")}
            onOpenProject={(project) => handleOpenProject(project.id)}
          />
        )}
        {view === "newProject" && (
          <NewProjectPage
            onCancel={() => setView("projects")}
            onCreate={handleCreateProject}
          />
        )}
        {(view === "editor" || view === "poster") && (
          <>
            {view === "poster" ? (
              <EditorScreen onExit={handleExitEditor} />
            ) : (
              <div
                className={`canvas-stack${references.length > 0 ? " canvas-stack-references" : ""}`}
                data-testid="canvas-stack"
              >
                <div className="canvas-stage">
                  {result ? (
                    <PosterResult
                      poster={result}
                      onDismiss={handleDismiss}
                      onEdit={handleEdit}
                    />
                  ) : (
                    activeProject && (
                      <PosterFrame
                        width={activeProject.posterSize.width}
                        height={activeProject.posterSize.height}
                      />
                    )
                  )}
                </div>
                {error && (
                  <p className="generation-error" role="alert">
                    {error}
                  </p>
                )}
                <FloatingIsland
                  busy={generating}
                  onGenerate={handleGenerate}
                  onOpenSettings={() => setProjectSettingsOpen(true)}
                />
              </div>
            )}
          </>
        )}
      </main>
      {settingsOpen && (
        <SettingsDialog scope="global" onClose={() => setSettingsOpen(false)} />
      )}
      {projectSettingsOpen && (
        <SettingsDialog
          scope="project"
          onClose={() => setProjectSettingsOpen(false)}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <ThemeProvider>
        <ProjectsProvider>
          <MoodboardProvider>
            <EditorProvider>
              <Shell />
            </EditorProvider>
          </MoodboardProvider>
        </ProjectsProvider>
      </ThemeProvider>
    </SettingsProvider>
  );
}
