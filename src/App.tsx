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
import {
  AgentConsole,
  type AgentChatMessage,
  type AgentTurnItem,
} from "./components/AgentConsole";
import { MoodboardProvider, useMoodboard } from "./state/MoodboardContext";
import { SettingsProvider, useSettings } from "./state/SettingsContext";
import { EditorProvider, useEditor } from "./state/EditorContext";
import { ProjectsProvider, useProjects } from "./state/ProjectsContext";
import {
  createDocument,
  type PosterDocument,
} from "./state/posterDocument";
import { errorMessage } from "./lib/generation";
import {
  cursorPositionForTool,
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
  const { setDocument, document: editorDocument } = useEditor();
  const {
    activeProject,
    createProject,
    selectProject,
    setTurnCount,
    updateProjectDocument,
    getProjectDocument,
  } = useProjects();
  const { settings: globalSettings } = useSettings();
  const [view, setView] = useState<View>("projects");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  const boardRef = useRef<HTMLCanvasElement | null>(null);
  const [agentDocument, setAgentDocument] = useState<PosterDocument | null>(
    null,
  );
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentStarted, setAgentStarted] = useState(false);
  const [agentChat, setAgentChat] = useState<AgentChatMessage[]>([]);
  const messageIdRef = useRef(0);
  const itemIdRef = useRef(0);
  const lastTurnNumberRef = useRef(0);
  // The animated cursor over the board while a canvas tool runs.
  const [agentCursor, setAgentCursor] = useState<{
    x: number;
    y: number;
    stamp: number;
  } | null>(null);
  const cursorStampRef = useRef(0);
  // The latest agent document, readable inside the event listener.
  const agentDocumentRef = useRef<PosterDocument | null>(null);

  function appendMessage(message: Omit<AgentChatMessage, "id">) {
    messageIdRef.current += 1;
    const id = messageIdRef.current;
    setAgentChat((current) => [...current, { id, ...message }]);
  }

  /** Stream one line into the open agent turn bubble. */
  function appendTurnItem(item: Omit<AgentTurnItem, "id">) {
    itemIdRef.current += 1;
    const itemId = itemIdRef.current;
    setAgentChat((current) => {
      const last = current[current.length - 1];
      if (last && last.kind === "agent") {
        return [
          ...current.slice(0, -1),
          { ...last, items: [...(last.items ?? []), { id: itemId, ...item }] },
        ];
      }
      // Defensive: the loop always emits a turn before any tool line.
      messageIdRef.current += 1;
      const number = lastTurnNumberRef.current + 1;
      lastTurnNumberRef.current = number;
      return [
        ...current,
        {
          id: messageIdRef.current,
          kind: "agent",
          number,
          items: [{ id: itemId, ...item }],
        },
      ];
    });
  }

  // Keep a ref of the latest agent document for the event listener.
  useEffect(() => {
    agentDocumentRef.current = agentDocument;
  }, [agentDocument]);

  // Persist the poster document to the active project so the design
  // survives restarts. A null document (navigation away) never clears
  // the saved design; only project removal clears it.
  useEffect(() => {
    if (agentDocument && activeProject) {
      updateProjectDocument(activeProject.id, agentDocument);
    }
  }, [agentDocument, updateProjectDocument]);

  // Sync full-editor changes back into the agent document so the
  // persistence effect above captures them.
  useEffect(() => {
    if (view === "poster" && editorDocument) {
      setAgentDocument(editorDocument);
    }
  }, [view, editorDocument]);

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
          lastTurnNumberRef.current = event.number;
          appendMessage({ kind: "agent", number: event.number, items: [] });
          break;
        case "toolCall":
          appendTurnItem({
            kind: "tool",
            text: `${event.name} ${summarizeToolArguments(
              event.name,
              event.arguments,
            )}`,
          });
          // A canvas-affecting tool raises the animated cursor.
          {
            const position = cursorPositionForTool(
              event.name,
              event.arguments,
              agentDocumentRef.current,
            );
            if (position) {
              cursorStampRef.current += 1;
              setAgentCursor({
                x: position.x,
                y: position.y,
                stamp: cursorStampRef.current,
              });
            }
          }
          break;
        case "toolResult":
          appendTurnItem({
            kind: "result",
            ok: event.ok,
            text: event.ok
              ? `${event.name}: ${event.detail}`
              : `${event.name} failed: ${event.detail}`,
          });
          break;
        case "imageProgress":
          appendTurnItem({ kind: "image", text: "Generating image..." });
          break;
        case "imageAdded":
          appendTurnItem({
            kind: "image",
            text: `Image added (${event.width} x ${event.height})`,
          });
          break;
        case "done":
          appendTurnItem({ kind: "done", text: event.summary });
          setAgentRunning(false);
          setAgentCursor(null);
          break;
        case "stopped":
          appendTurnItem({ kind: "stopped", text: "Stopped by user" });
          setAgentRunning(false);
          setAgentCursor(null);
          break;
        case "error":
          appendTurnItem({ kind: "error", text: event.message });
          setAgentRunning(false);
          setAgentCursor(null);
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
    setAgentChat([]);
    setAgentRunning(false);
    setAgentStarted(false);
    setAgentCursor(null);
    messageIdRef.current = 0;
    itemIdRef.current = 0;
    lastTurnNumberRef.current = 0;
  }

  async function handleAgentRun(prompt: string) {
    const size = activeProject?.posterSize;
    if (!size) {
      return;
    }
    setAgentRunning(true);
    setAgentStarted(true);
    setAgentCursor(null);
    appendMessage({ kind: "user", prompt });
    try {
      const payloads = await referencePayloads(references);
      const params =
        activeProject?.settings.params ?? defaultProjectSettings().params;
      const base = agentDocument ?? createDocument(size.width, size.height);
      const startTurn = activeProject?.turnCount ?? 0;
      const outcome = await runAgent({
        prompt,
        document: base,
        settings: globalSettings ?? defaultGlobalSettings(),
        params,
        references: payloads,
        startTurn,
      });
      setAgentDocument(outcome.document);
      setAgentRunning(false);
      if (activeProject) {
        const turns = outcome.events.filter(
          (event) => event.kind === "turn",
        ).length;
        setTurnCount(activeProject.id, startTurn + turns);
      }
    } catch (err) {
      appendTurnItem({ kind: "error", text: errorMessage(err) });
      setAgentRunning(false);
      setAgentCursor(null);
    }
  }

  function handleAgentStop() {
    void stopAgent().catch(() => undefined);
  }

  function resetGeneration() {
    clearReferences();
    resetAgentState();
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
    // Restore the saved design so it survives app restarts.
    setAgentDocument(getProjectDocument(projectId));
    setView("editor");
  }

  function handleEdit() {
    if (!agentDocument) {
      return;
    }
    setDocument(agentDocument);
    setView("poster");
  }

  function handleExitEditor() {
    setView("editor");
    resetGeneration();
    // Keep the design on the board after the full editor closes.
    if (activeProject) {
      setAgentDocument(getProjectDocument(activeProject.id));
    }
  }

  const inEditor = view === "editor" || view === "poster";
  const boardBottomInset = references.length > 0 ? 184 : 112;
  const previewSize = activeProject?.posterSize
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
            >
              <span className="header-back-icon" aria-hidden="true">
                <Cactus
                  size={18}
                  weight="fill"
                  className="header-back-icon-fill"
                />
                <Cactus
                  size={18}
                  weight="regular"
                  className="header-back-icon-regular"
                />
              </span>
            </button>
          )}
        </div>
        {view === "editor" && (
          <div className="header-center">
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
          </div>
        )}
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
            view === "editor" && !agentDocument && activeProject
              ? "img"
              : undefined
          }
          aria-label={
            view === "editor" && !agentDocument && activeProject
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
          posterSize={activeProject?.posterSize ?? null}
          document={agentDocument}
          cursor={agentCursor}
          bottomInset={boardBottomInset}
          onZoomChange={setPreviewZoom}
        />
      )}
      {view === "editor" && agentStarted && (
        <AgentConsole
          running={agentRunning}
          chat={agentChat}
          onStop={handleAgentStop}
          onEdit={handleEdit}
          canEdit={agentDocument !== null}
        />
      )}
      {view === "editor" && (
        <FloatingIsland
          busy={agentRunning}
          onRun={(prompt) => void handleAgentRun(prompt)}
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
