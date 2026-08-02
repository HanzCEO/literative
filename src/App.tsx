import { useEffect, useRef, useState } from "react";
import { Cactus, GearSix } from "@phosphor-icons/react";
import { ThemeProvider } from "./theme/ThemeContext";
import { ThemeToggle } from "./components/ThemeToggle";
import { SettingsDialog } from "./components/SettingsDialog";
import { FloatingIsland } from "./components/FloatingIsland";
import { GenerationBoard } from "./components/GenerationBoard";
import { EditorScreen } from "./components/editor/EditorScreen";
import { ProjectListPage } from "./components/ProjectListPage";
import { NewProjectPage } from "./components/NewProjectPage";
import { AgentConsole, type AgentActivityItem } from "./components/AgentConsole";
import { MoodboardProvider, useMoodboard } from "./state/MoodboardContext";
import { SettingsProvider, useSettings } from "./state/SettingsContext";
import { EditorProvider, useEditor } from "./state/EditorContext";
import { ProjectsProvider, useProjects } from "./state/ProjectsContext";
import {
  createDocument,
  createDocumentFromImage,
  createDocumentWithImage,
  type PosterDocument,
} from "./state/posterDocument";
import { errorMessage, generatePoster, type GeneratedPoster } from "./lib/generation";
import {
  listenAgentEvents,
  referencePayloads,
  runAgent,
  stopAgent,
  summarizeToolArguments,
  type AgentEvent,
} from "./lib/agent";
import { defaultGlobalSettings, defaultProjectSettings } from "./state/settingsTypes";
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
  const [previewZoom, setPreviewZoom] = useState(1);
  const boardRef = useRef<HTMLCanvasElement | null>(null);
  const [agentDocument, setAgentDocument] = useState<PosterDocument | null>(
    null,
  );
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentActivity, setAgentActivity] = useState<AgentActivityItem[]>([]);
  const activityIdRef = useRef(0);

  function appendActivity(item: Omit<AgentActivityItem, "id">) {
    activityIdRef.current += 1;
    const id = activityIdRef.current;
    setAgentActivity((current) => [...current, { id, ...item }]);
  }

  // Stream agent events into the document, the activity log, and the
  // running flag.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const handleEvent = (event: AgentEvent) => {
      if (disposed) {
        return;
      }
      switch (event.kind) {
        case "document":
          setAgentDocument(event.document);
          break;
        case "turn":
          appendActivity({
            kind: "turn",
            text: `Turn ${event.number}`,
          });
          break;
        case "toolCall":
          appendActivity({
            kind: "tool",
            text: `${event.name} ${summarizeToolArguments(
              event.name,
              event.arguments,
            )}`,
          });
          break;
        case "toolResult":
          appendActivity({
            kind: "result",
            ok: event.ok,
            text: event.ok
              ? `${event.name}: ${event.detail}`
              : `${event.name} failed: ${event.detail}`,
          });
          break;
        case "imageProgress":
          appendActivity({ kind: "image", text: "Generating image..." });
          break;
        case "imageAdded":
          appendActivity({
            kind: "image",
            text: `Image added (${event.width} x ${event.height})`,
          });
          break;
        case "done":
          appendActivity({ kind: "done", text: event.summary });
          setAgentRunning(false);
          break;
        case "stopped":
          appendActivity({ kind: "stopped", text: "Stopped by user" });
          setAgentRunning(false);
          break;
        case "error":
          appendActivity({ kind: "error", text: event.message });
          setAgentRunning(false);
          break;
      }
    };
    void listenAgentEvents(handleEvent)
      .then((stop) => {
        unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  function resetAgentState() {
    setAgentDocument(null);
    setAgentActivity([]);
    setAgentRunning(false);
  }

  async function handleAgentRun(prompt: string) {
    const size = activeProject?.posterSize;
    if (!size) {
      return;
    }
    setGenerating(false);
    setError(null);
    setResult(null);
    setAgentRunning(true);
    try {
      const payloads = await referencePayloads(references);
      const params =
        activeProject?.settings.params ?? defaultProjectSettings().params;
      const base = agentDocument ?? createDocument(size.width, size.height);
      const outcome = await runAgent({
        prompt,
        document: base,
        settings: globalSettings ?? defaultGlobalSettings(),
        params,
        references: payloads,
      });
      setAgentDocument(outcome.document);
      setAgentRunning(false);
    } catch (err) {
      appendActivity({ kind: "error", text: errorMessage(err) });
      setAgentRunning(false);
    }
  }

  function handleAgentStop() {
    void stopAgent().catch(() => undefined);
  }

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
    resetAgentState();
    setView("editor");
  }

  function handleOpenProject(projectId: string) {
    selectProject(projectId);
    resetGeneration();
    resetAgentState();
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
    if (agentDocument) {
      setDocument(agentDocument);
    } else if (result) {
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
    } else {
      return;
    }
    setView("poster");
  }

  function handleExitEditor() {
    setView("editor");
    resetGeneration();
  }

  const inEditor = view === "editor" || view === "poster";
  const boardBottomInset = references.length > 0 ? 184 : 112;
  const previewSize = result
    ? `${result.width} x ${result.height} px`
    : activeProject?.posterSize
      ? `${activeProject.posterSize.width} x ${activeProject.posterSize.height} px`
      : null;

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
        <div className="header-center">
          {view === "editor" && (
            <>
              <span
                className="header-zoom"
                aria-label="Preview zoom level"
                title="Scroll to zoom, drag to pan"
              >
                Zoom {Math.round(previewZoom * 100)}%
              </span>
              {previewSize && (
                <>
                  <span className="header-zoom-divider" aria-hidden="true" />
                  <span className="header-size">{previewSize}</span>
                </>
              )}
            </>
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
      {inEditor ? (
        <canvas
          className="canvas-area board-canvas"
          data-testid="canvas-area"
          ref={boardRef}
          role={
            view === "editor" && !result && activeProject ? "img" : undefined
          }
          aria-label={
            view === "editor" && !result && activeProject
              ? `Poster base canvas ${activeProject.posterSize.width} by ${activeProject.posterSize.height} pixels`
              : undefined
          }
        />
      ) : (
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
        </main>
      )}
      {view === "poster" && (
        <EditorScreen boardRef={boardRef} onExit={handleExitEditor} />
      )}
      {view === "editor" && (
        <GenerationBoard
          boardRef={boardRef}
          result={result}
          error={error}
          posterSize={activeProject?.posterSize ?? null}
          document={agentDocument}
          bottomInset={boardBottomInset}
          onEdit={handleEdit}
          onDismiss={handleDismiss}
          onZoomChange={setPreviewZoom}
        />
      )}
      {view === "editor" && (
        <AgentConsole
          running={agentRunning}
          activity={agentActivity}
          onRun={(prompt) => void handleAgentRun(prompt)}
          onStop={handleAgentStop}
          onEdit={handleEdit}
          canEdit={agentDocument !== null}
          disabled={!activeProject}
        />
      )}
      {view === "editor" && (
        <FloatingIsland
          busy={generating}
          onGenerate={handleGenerate}
          onOpenSettings={() => setProjectSettingsOpen(true)}
        />
      )}
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
