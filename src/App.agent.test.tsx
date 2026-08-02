import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import App from "./App";
import type { AgentEvent } from "./lib/agent";

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
      document: { width: number; height: number; layers: unknown[] };
      params: { width: number };
      references: unknown[];
    };
    expect(request.prompt).toBe("A jazz poster");
    expect(request.document.width).toBe(1024);
    expect(request.document.height).toBe(1536);
    expect(request.document.layers).toEqual([]);
    expect(request.params.width).toBe(1024);
    expect(request.references).toEqual([]);
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

    expect(screen.getByText("place_object ellipse")).toBeInTheDocument();
    expect(
      screen.getByText("place_object: placed ellipse as ag-1"),
    ).toBeInTheDocument();
    expect(screen.getByText("Finished the poster.")).toBeInTheDocument();

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
