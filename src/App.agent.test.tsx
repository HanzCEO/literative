import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
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
  await screen.findByRole("textbox", { name: "Agent prompt" });
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

describe("agent console", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    onDragDropEvent.mockReset();
    onDragDropEvent.mockResolvedValue(vi.fn());
    mockedListen.mockReset();
    mockedListen.mockResolvedValue(vi.fn());
  });

  it("runs the agent with the poster document and settings", async () => {
    const user = userEvent.setup();
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

    await user.type(
      screen.getByRole("textbox", { name: "Agent prompt" }),
      "A jazz poster",
    );
    await user.click(screen.getByRole("button", { name: "Run agent" }));

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

  it("streams tool activity and applies the document", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "agent_run") {
        return { document: null, events: [] };
      }
      return null;
    });
    await openEditor();

    await user.type(
      screen.getByRole("textbox", { name: "Agent prompt" }),
      "Add a red circle",
    );
    await user.click(screen.getByRole("button", { name: "Run agent" }));

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
    await user.click(
      screen.getByRole("button", { name: "Open agent result in editor" }),
    );
    // The editor opens with the agent's shape layer listed.
    const rows = await screen.findAllByTestId(/layer-row-/);
    expect(rows).toHaveLength(1);
    expect(screen.getByText("Ellipse")).toBeInTheDocument();
  });

  it("stops the running agent on demand", async () => {
    const user = userEvent.setup();
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

    await user.type(
      screen.getByRole("textbox", { name: "Agent prompt" }),
      "make it",
    );
    await user.click(screen.getByRole("button", { name: "Run agent" }));

    await user.click(screen.getByRole("button", { name: "Stop agent" }));
    expect(
      mockedInvoke.mock.calls.some(([name]) => name === "agent_stop"),
    ).toBe(true);

    // The run resolves; the console returns to idle.
    await act(async () => {
      resolveRun({ document: null, events: [] });
    });
    expect(
      screen.queryByRole("button", { name: "Stop agent" }),
    ).not.toBeInTheDocument();
  });

  it("shows the agent error and stops the run", async () => {
    const user = userEvent.setup();
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

    await user.type(
      screen.getByRole("textbox", { name: "Agent prompt" }),
      "make it",
    );
    await user.click(screen.getByRole("button", { name: "Run agent" }));

    expect(
      await screen.findByText("completion model is not configured"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Stop agent" }),
    ).not.toBeInTheDocument();
  });

  it("records a failed tool result from the guardrail", async () => {
    const user = userEvent.setup();
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

    await user.type(
      screen.getByRole("textbox", { name: "Agent prompt" }),
      "poster",
    );
    await user.click(screen.getByRole("button", { name: "Run agent" }));

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
