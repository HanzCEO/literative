import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import App from "./App";
import type { AgentEvent } from "./lib/agent";
import type { Layer } from "./state/posterDocument";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));
const { onDragDropEvent } = vi.hoisted(() => ({ onDragDropEvent: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent }),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedListen = vi.mocked(listen);

/** Create a project through onboarding and wait for the generation view. */
async function openEditor() {
  render(<App />);
  const user = userEvent.setup();
  await user.click(screen.getAllByRole("button", { name: "New project" })[0]);
  await user.type(screen.getByLabelText("Project name"), "Test project");
  await user.click(screen.getByRole("button", { name: "Create project" }));
  await screen.findByRole("textbox", { name: "Poster prompt" });
}

/** Submit a prompt through the single island input. */
async function submitPrompt(prompt: string) {
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Poster prompt" }),
    prompt,
  );
  await user.click(screen.getByRole("button", { name: "Generate poster" }));
}

/** Emit an agent event through the captured listener. */
function emitAgentEvent(event: AgentEvent) {
  const handler = mockedListen.mock.calls.find(
    ([name]) => name === "agent-event",
  )?.[1];
  if (!handler) {
    throw new Error("no agent-event listener registered");
  }
  act(() => {
    handler({ event: "agent-event", id: 1, payload: event });
  });
}

/** Read the x and y from a translate3d transform string. */
function parsePosition(transform: string): { x: number; y: number } {
  const match = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec(transform);
  if (!match) {
    throw new Error(`unexpected transform: ${transform}`);
  }
  return { x: Number(match[1]), y: Number(match[2]) };
}

describe("agent chat", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    onDragDropEvent.mockReset();
    onDragDropEvent.mockResolvedValue(vi.fn());
    mockedListen.mockReset();
    mockedListen.mockResolvedValue(vi.fn());
  });

  it("runs the agent from the island prompt with the poster document", async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "get_app_settings") {
        return null;
      }
      if (command === "agent_run") {
        return { document: null, events: [] };
      }
      return null;
    });
    await openEditor();

    await submitPrompt("A jazz poster");

    const call = mockedInvoke.mock.calls.find(([name]) => name === "agent_run");
    expect(call).toBeDefined();
    const request = (call as unknown as [string, { request: unknown }])[1]
      .request as {
      prompt: string;
      startTurn: number;
      document: { width: number; height: number; layers: unknown[] };
      params: { width: number };
      references: unknown[];
    };
    expect(request.prompt).toBe("A jazz poster");
    expect(request.startTurn).toBe(0);
    expect(request.document.width).toBe(1024);
    expect(request.document.height).toBe(1536);
    expect(request.document.layers).toEqual([]);
    expect(request.params.width).toBe(1024);
    expect(request.references).toEqual([]);
  });

  it("continues the turn count across runs in the same project", async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "get_app_settings") {
        return null;
      }
      if (command === "agent_run") {
        return {
          document: null,
          events: [
            { kind: "turn", number: 1 },
            { kind: "turn", number: 2 },
            { kind: "turn", number: 3 },
          ],
        };
      }
      return null;
    });
    await openEditor();

    await submitPrompt("first prompt");
    await submitPrompt("second prompt");

    const calls = mockedInvoke.mock.calls.filter(
      ([name]) => name === "agent_run",
    );
    expect(calls).toHaveLength(2);
    const startTurn = (call: unknown[]) =>
      (call[1] as { request: { startTurn: number } }).request.startTurn;
    // The first run starts the count; the second continues it.
    expect(startTurn(calls[0])).toBe(0);
    expect(startTurn(calls[1])).toBe(3);
  });

  it("hides the chat bubble until the user prompts", async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "get_app_settings") {
        return null;
      }
      if (command === "agent_run") {
        return { document: null, events: [] };
      }
      return null;
    });
    await openEditor();
    // The island prompt is the only entry point, and no chat bubble
    // floats before the first prompt.
    expect(
      screen.getByRole("textbox", { name: "Poster prompt" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Agent prompt" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "Design agent chat" }),
    ).not.toBeInTheDocument();

    // Prompting through the island raises the chat bubble.
    await submitPrompt("A jazz poster");
    expect(
      await screen.findByRole("complementary", {
        name: "Design agent chat",
      }),
    ).toBeInTheDocument();
  });

  it("does not zoom while wheeling over the chat bubble", async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "get_app_settings") {
        return null;
      }
      if (command === "agent_run") {
        return { document: null, events: [] };
      }
      return null;
    });
    await openEditor();
    await submitPrompt("poster");
    const bubble = screen
      .getByRole("complementary", { name: "Design agent chat" })
      .querySelector(".agent-activity");
    expect(bubble).not.toBeNull();
    fireEvent.wheel(bubble!, { deltaY: -100 });
    expect(screen.getByLabelText("Preview zoom level")).toHaveTextContent(
      "Zoom 100%",
    );
  });

  it("scrolls the chat to the bottom when a new line streams in", async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "get_app_settings") {
        return null;
      }
      if (command === "agent_run") {
        return { document: null, events: [] };
      }
      return null;
    });
    await openEditor();
    await submitPrompt("A jazz poster");
    emitAgentEvent({ kind: "turn", number: 1 });

    const list = document.querySelector(".agent-activity") as HTMLElement;
    Object.defineProperty(list, "scrollHeight", {
      value: 600,
      configurable: true,
    });
    Object.defineProperty(list, "clientHeight", {
      value: 200,
      configurable: true,
    });
    list.scrollTop = 0;

    emitAgentEvent({
      kind: "toolResult",
      name: "place_object",
      ok: true,
      detail: "placed ellipse as ag-1",
    });
    // Pinned to the bottom: the newest line pulled the list down.
    expect(list.scrollTop).toBe(600);
  });

  it("keeps the chat position when the user has scrolled up", async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "get_app_settings") {
        return null;
      }
      if (command === "agent_run") {
        return { document: null, events: [] };
      }
      return null;
    });
    await openEditor();
    await submitPrompt("A jazz poster");
    emitAgentEvent({ kind: "turn", number: 1 });

    const list = document.querySelector(".agent-activity") as HTMLElement;
    Object.defineProperty(list, "scrollHeight", {
      value: 600,
      configurable: true,
    });
    Object.defineProperty(list, "clientHeight", {
      value: 200,
      configurable: true,
    });
    list.scrollTop = 0;
    fireEvent.scroll(list);

    emitAgentEvent({
      kind: "toolResult",
      name: "place_object",
      ok: true,
      detail: "placed ellipse as ag-1",
    });
    // The user is reading older lines; new activity must not yank them.
    expect(list.scrollTop).toBe(0);

    // Scrolling back to the bottom re-pins the list.
    list.scrollTop = 400;
    fireEvent.scroll(list);
    emitAgentEvent({
      kind: "toolResult",
      name: "place_object",
      ok: true,
      detail: "placed text as ag-2",
    });
    expect(list.scrollTop).toBe(600);
  });

  it("streams tool activity and applies the document", async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "get_app_settings") {
        return null;
      }
      if (command === "agent_run") {
        return { document: null, events: [] };
      }
      return null;
    });
    await openEditor();

    await submitPrompt("Add a red circle");

    emitAgentEvent({ kind: "turn", number: 1 });
    emitAgentEvent({
      kind: "toolCall",
      name: "place_object",
      arguments: { kind: "ellipse", x: 100, y: 200, width: 300, height: 300 },
    });
    emitAgentEvent({
      kind: "toolResult",
      name: "place_object",
      ok: true,
      detail: "placed ellipse as ag-1",
    });
    // The document snapshot the agent produced.
    emitAgentEvent({
      kind: "document",
      document: {
        width: 1024,
        height: 1536,
        sheetX: 0,
        sheetY: 0,
        layers: [
          {
            id: "ag-1",
            kind: "shape",
            name: "Ellipse",
            visible: true,
            opacity: 1,
            blendMode: "source-over",
            x: 100,
            y: 200,
            rotation: 0,
            shapeType: "ellipse",
            fill: "#e5484d",
            stroke: "#1a1a1f",
            strokeWidth: 0,
            cornerRadius: 0,
            width: 300,
            height: 300,
          },
        ],
      },
    });
    emitAgentEvent({ kind: "done", summary: "Finished the poster." });

    // The user prompt is its own bubble.
    const userBubble = screen.getByText("Add a red circle");
    expect(userBubble.closest("li")).toHaveClass("agent-bubble-user");
    // The turn streams into its own separated bubble.
    const turnBubble = screen.getByText("Turn 1").closest("li");
    expect(turnBubble).toHaveClass("agent-bubble-turn");
    expect(turnBubble).toHaveTextContent("place_object ellipse");
    expect(turnBubble).toHaveTextContent("place_object: placed ellipse as ag-1");
    expect(turnBubble).toHaveTextContent("Finished the poster.");

    // The document event enables the open-in-editor action.
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Open agent result in editor" }),
    );
    // The editor opens with the agent's shape layer listed.
    const rows = await screen.findAllByTestId(/layer-row-/);
    expect(rows).toHaveLength(1);
    expect(screen.getByText("Ellipse")).toBeInTheDocument();
  });

  it("stops the running agent on demand", async () => {
    let resolveRun: (value: unknown) => void = () => undefined;
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "get_app_settings") {
        return null;
      }
      if (command === "agent_run") {
        return new Promise((resolve) => {
          resolveRun = resolve;
        });
      }
      if (command === "agent_stop") {
        return null;
      }
      return null;
    });
    await openEditor();

    await submitPrompt("make it");
    await screen.findByRole("button", { name: "Stop agent" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Stop agent" }));
    expect(
      mockedInvoke.mock.calls.some(([name]) => name === "agent_stop"),
    ).toBe(true);

    // The run resolves; the bubble returns to idle.
    await act(async () => {
      resolveRun({ document: null, events: [] });
    });
    expect(
      screen.queryByRole("button", { name: "Stop agent" }),
    ).not.toBeInTheDocument();
  });

  it("shows the agent error and stops the run", async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "get_app_settings") {
        return null;
      }
      if (command === "agent_run") {
        throw "completion model is not configured";
      }
      return null;
    });
    await openEditor();

    await submitPrompt("make it");

    expect(
      await screen.findByText("completion model is not configured"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Stop agent" }),
    ).not.toBeInTheDocument();
  });

  it("splits every agent turn into its own bubble", async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "get_app_settings") {
        return null;
      }
      if (command === "agent_run") {
        return { document: null, events: [] };
      }
      return null;
    });
    await openEditor();

    await submitPrompt("A jazz poster");
    emitAgentEvent({ kind: "turn", number: 1 });
    emitAgentEvent({
      kind: "toolCall",
      name: "place_object",
      arguments: { kind: "ellipse" },
    });
    emitAgentEvent({ kind: "turn", number: 2 });

    const bubbles = document.querySelectorAll(".agent-bubble-turn");
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]).toHaveTextContent("Turn 1");
    expect(bubbles[0]).toHaveTextContent("place_object ellipse");
    expect(bubbles[1]).toHaveTextContent("Turn 2");
    // The second turn's tool stream stays out of the first bubble.
    expect(bubbles[1]).not.toHaveTextContent("place_object ellipse");
  });

  it("shows the animated cursor while a canvas tool runs", async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "get_app_settings") {
        return null;
      }
      if (command === "agent_run") {
        return { document: null, events: [] };
      }
      return null;
    });
    await openEditor();
    await submitPrompt("Add a red circle");
    emitAgentEvent({ kind: "turn", number: 1 });
    expect(document.querySelector(".agent-cursor")).toBeNull();

    // A canvas-affecting tool raises the cursor at its document point.
    emitAgentEvent({
      kind: "toolCall",
      name: "place_object",
      arguments: { kind: "ellipse", x: 100, y: 200 },
    });
    const cursor = document.querySelector(".agent-cursor");
    expect(cursor).not.toBeNull();
    const first = parsePosition((cursor as HTMLElement).style.transform);
    expect(first.x).not.toBe(0);

    // A later tool at a new point moves the cursor by the coordinate
    // delta on both axes, so it tracks the document point.
    emitAgentEvent({
      kind: "toolCall",
      name: "move_object",
      arguments: { id: "ag-1", x: 200, y: 300 },
    });
    const second = parsePosition(
      (document.querySelector(".agent-cursor") as HTMLElement).style
        .transform,
    );
    expect(second.x - first.x).toBeCloseTo(second.y - first.y, 5);

    // The run end removes the cursor.
    emitAgentEvent({ kind: "done", summary: "Finished." });
    expect(document.querySelector(".agent-cursor")).toBeNull();
  });

  it("keeps the cursor hidden for a run error", async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "get_app_settings") {
        return null;
      }
      if (command === "agent_run") {
        throw "completion model is not configured";
      }
      return null;
    });
    await openEditor();
    await submitPrompt("make it");
    expect(await screen.findByText("completion model is not configured")).toBeInTheDocument();
    expect(document.querySelector(".agent-cursor")).toBeNull();
  });

  it("records a failed tool result from the guardrail", async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "get_app_settings") {
        return null;
      }
      if (command === "agent_run") {
        return { document: null, events: [] };
      }
      return null;
    });
    await openEditor();

    await submitPrompt("poster");

    emitAgentEvent({
      kind: "toolResult",
      name: "generate_image",
      ok: false,
      detail: "Refused: the image model cannot render text.",
    });
    expect(
      screen.getByText(
        "generate_image failed: Refused: the image model cannot render text.",
      ),
    ).toBeInTheDocument();
  });
});

describe("project persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    mockedInvoke.mockReset();
    onDragDropEvent.mockReset();
    onDragDropEvent.mockResolvedValue(vi.fn());
    mockedListen.mockReset();
    mockedListen.mockResolvedValue(vi.fn());
  });

  const savedLayer: Layer = {
    id: "ag-1",
    kind: "shape",
    name: "Ellipse",
    visible: true,
    opacity: 1,
    blendMode: "source-over",
    x: 100,
    y: 200,
    rotation: 0,
    shapeType: "ellipse",
    fill: "#e5484d",
    stroke: "#1a1a1f",
    strokeWidth: 0,
    cornerRadius: 0,
    width: 300,
    height: 300,
  };

  function seedProject(name = "Restored project") {
    localStorage.setItem(
      "literative.projects",
      JSON.stringify([
        {
          id: "p1",
          name,
          description: "",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          posterSize: { width: 1024, height: 1536 },
        },
      ]),
    );
  }

  function seedDocument() {
    localStorage.setItem(
      "literative.project.p1.document",
      JSON.stringify({
        width: 1024,
        height: 1536,
        sheetX: 0,
        sheetY: 0,
        layers: [savedLayer],
      }),
    );
  }

  it("saves the agent document under the project key", async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "get_app_settings") {
        return null;
      }
      if (command === "agent_run") {
        return { document: null, events: [] };
      }
      return null;
    });
    await openEditor();

    await submitPrompt("A jazz poster");
    emitAgentEvent({
      kind: "document",
      document: {
        width: 1024,
        height: 1536,
        sheetX: 0,
        sheetY: 0,
        layers: [savedLayer],
      },
    });
    emitAgentEvent({ kind: "done", summary: "Finished the poster." });

    const projects = JSON.parse(
      localStorage.getItem("literative.projects") ?? "[]",
    ) as { id: string }[];
    expect(projects).toHaveLength(1);
    const saved = localStorage.getItem(
      `literative.project.${projects[0].id}.document`,
    );
    expect(saved).not.toBeNull();
    const document = JSON.parse(saved!) as { layers: unknown[] };
    expect(document.layers).toHaveLength(1);
    expect(document.layers[0]).toMatchObject({ id: "ag-1" });
  });

  it("restores the saved document when the project reopens", async () => {
    seedProject();
    seedDocument();
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "get_app_settings") {
        return null;
      }
      if (command === "agent_run") {
        return { document: null, events: [] };
      }
      return null;
    });
    const user = userEvent.setup();
    render(<App />);

    // Open the seeded project from the list.
    await user.click(
      screen.getByRole("button", { name: /^Restored project/ }),
    );
    // The board carries the design, not the empty base canvas.
    expect(
      screen.queryByRole("img", {
        name: "Poster base canvas 1024 by 1536 pixels",
      }),
    ).not.toBeInTheDocument();

    // A new run builds on the restored layers.
    await submitPrompt("make it bigger");
    const call = mockedInvoke.mock.calls.find(([name]) => name === "agent_run");
    const request = (call as unknown as [string, { request: unknown }])[1]
      .request as { document: { layers: unknown[] } };
    expect(request.document.layers).toHaveLength(1);
    expect(request.document.layers[0]).toMatchObject({ id: "ag-1" });
  });

  it("clears the saved document when the project is deleted", async () => {
    seedProject();
    seedDocument();
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "get_app_settings") {
        return null;
      }
      if (command === "agent_run") {
        return { document: null, events: [] };
      }
      return null;
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      screen.getByRole("button", { name: "Options for Restored project" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      localStorage.getItem("literative.project.p1.document"),
    ).toBeNull();
  });

  it("persists edits made in the full editor", async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "get_app_settings") {
        return null;
      }
      if (command === "agent_run") {
        return { document: null, events: [] };
      }
      return null;
    });
    await openEditor();
    await submitPrompt("A jazz poster");
    emitAgentEvent({
      kind: "document",
      document: {
        width: 1024,
        height: 1536,
        sheetX: 0,
        sheetY: 0,
        layers: [savedLayer],
      },
    });
    emitAgentEvent({ kind: "done", summary: "Finished the poster." });

    // Open the agent result in the full editor and add a text layer.
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Open agent result in editor" }),
    );
    await user.click(screen.getByRole("button", { name: "Add text" }));
    await screen.findAllByTestId(/layer-row-/);

    const projects = JSON.parse(
      localStorage.getItem("literative.projects") ?? "[]",
    ) as { id: string }[];
    const saved = localStorage.getItem(
      `literative.project.${projects[0].id}.document`,
    );
    const document = JSON.parse(saved!) as { layers: unknown[] };
    expect(document.layers).toHaveLength(2);
  });

  it("saves the agent chat under the project key", async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "get_app_settings") {
        return null;
      }
      if (command === "agent_run") {
        return { document: null, events: [] };
      }
      return null;
    });
    await openEditor();

    await submitPrompt("A jazz poster");
    emitAgentEvent({ kind: "turn", number: 1 });
    emitAgentEvent({
      kind: "toolResult",
      name: "place_object",
      ok: true,
      detail: "placed ellipse as ag-1",
    });
    emitAgentEvent({ kind: "done", summary: "Finished the poster." });

    const projects = JSON.parse(
      localStorage.getItem("literative.projects") ?? "[]",
    ) as { id: string }[];
    const saved = localStorage.getItem(
      `literative.project.${projects[0].id}.chat`,
    );
    expect(saved).not.toBeNull();
    const chat = JSON.parse(saved!) as {
      kind: string;
      prompt?: string;
    }[];
    expect(chat).toHaveLength(2);
    expect(chat[0]).toMatchObject({ kind: "user", prompt: "A jazz poster" });
    expect(chat[1]).toMatchObject({ kind: "agent", number: 1 });
  });

  it("restores the saved chat when the project reopens", async () => {
    seedProject();
    localStorage.setItem(
      "literative.project.p1.chat",
      JSON.stringify([
        { id: 1, kind: "user", prompt: "saved prompt" },
        {
          id: 2,
          kind: "agent",
          number: 1,
          items: [{ id: 1, kind: "done", text: "Saved summary." }],
        },
      ]),
    );
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "get_app_settings") {
        return null;
      }
      if (command === "agent_run") {
        return { document: null, events: [] };
      }
      return null;
    });
    const user = userEvent.setup();
    render(<App />);

    // Open the seeded project; the saved session bubbles appear.
    await user.click(
      screen.getByRole("button", { name: /^Restored project/ }),
    );
    expect(
      await screen.findByRole("complementary", {
        name: "Design agent chat",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("saved prompt")).toBeInTheDocument();
    expect(screen.getByText("Saved summary.")).toBeInTheDocument();
  });

  it("clears the saved chat when the project is deleted", async () => {
    seedProject();
    localStorage.setItem(
      "literative.project.p1.chat",
      JSON.stringify([{ id: 1, kind: "user", prompt: "saved prompt" }]),
    );
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "get_app_settings") {
        return null;
      }
      if (command === "agent_run") {
        return { document: null, events: [] };
      }
      return null;
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      screen.getByRole("button", { name: "Options for Restored project" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      localStorage.getItem("literative.project.p1.chat"),
    ).toBeNull();
  });
});
