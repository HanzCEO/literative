import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { defaultGlobalSettings } from "./state/settingsTypes";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
const { onDragDropEvent } = vi.hoisted(() => ({ onDragDropEvent: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent }),
}));

const mockedInvoke = vi.mocked(invoke);

/** Replace the canvas 2D context with a stub that records drawImage calls. */
function recordCanvasContext() {
  const blits: number[][] = [];
  const transforms: number[][] = [];
  const rects: number[][] = [];
  const clips: number[][] = [];
  const target: Record<string, unknown> = {
    drawImage: (...args: unknown[]) => blits.push(args as number[]),
    setTransform: (...args: number[]) => transforms.push(args),
    rect: (...args: number[]) => rects.push(args),
    clip: (...args: number[]) => clips.push(args),
  };
  const stub = new Proxy(target, {
    get(_, prop) {
      if (prop === "canvas") {
        return { width: 300, height: 150 };
      }
      if (typeof prop === "string" && prop in target) {
        return target[prop];
      }
      if (typeof prop === "string") {
        target[prop] = () => {};
      }
      return target[prop as string];
    },
    set(_, prop, value) {
      target[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const spy = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(stub);
  return { blits, transforms, rects, clips, spy };
}

/** Offset of the latest pan blit: drawImage(cache, dx, dy, w, h). */
function lastBlitOffset(blits: number[][]): number {
  const fiveArg = blits.filter((args) => args.length === 5);
  const last = fiveArg[fiveArg.length - 1];
  return (last?.[1] as number) ?? 0;
}

function panBlitCount(blits: number[][]): number {
  return blits.filter((args) => args.length === 5).length;
}

/** Create a project through onboarding and wait for the editor. */
async function openEditor() {
  render(<App />);
  const user = userEvent.setup();
  await user.click(screen.getAllByRole("button", { name: "New project" })[0]);
  await user.type(screen.getByLabelText("Project name"), "Test project");
  await user.click(screen.getByRole("button", { name: "Create project" }));
  await screen.findByRole("textbox", { name: "Poster prompt" });
}

/** Drop one image path at the registered Tauri drag-drop handler. */
function dropImage() {
  const handler = onDragDropEvent.mock.calls[0][0];
  act(() => {
    handler({
      payload: {
        type: "drop",
        paths: ["/tmp/mood.png"],
        position: { x: 0, y: 0 },
      },
    });
  });
}

describe("generation flow", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    onDragDropEvent.mockReset();
    onDragDropEvent.mockResolvedValue(vi.fn());
  });

  it("runs the agent from the island prompt", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "get_app_settings") {
        return null;
      }
      if (command === "agent_run") {
        return {
          document: {
            width: 1024,
            height: 1536,
            sheetX: 0,
            sheetY: 0,
            layers: [],
          },
          events: [],
        };
      }
      return null;
    });
    await openEditor();
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    await user.type(input, "A neon jazz poster");
    await user.click(screen.getByRole("button", { name: "Generate poster" }));

    const agentCall = mockedInvoke.mock.calls.find(
      (call) => call[0] === "agent_run",
    );
    expect(agentCall).toBeDefined();
    const request = (agentCall![1] as { request: { prompt: string } }).request;
    expect(request.prompt).toBe("A neon jazz poster");
    // The chat bubble is the single agent surface; the island input is
    // the only prompt entry point.
    expect(
      screen.getByRole("complementary", { name: "Design agent chat" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Agent prompt" }),
    ).not.toBeInTheDocument();
  });

  it("shows the zoom level and poster size together in the navbar center", async () => {
    await openEditor();
    const zoom = screen.getByLabelText("Preview zoom level");
    // The indicator lives inside the top app navbar, not the canvas.
    expect(zoom.closest(".app-header")).not.toBeNull();
    const center = zoom.parentElement;
    expect(center).not.toBeNull();
    expect(center).toHaveTextContent("Zoom 100%");
    expect(center).toHaveTextContent("1024 x 1536 px");
  });

  it("zooms the preview canvas with the wheel", async () => {
    await openEditor();
    const canvas = document.querySelector(".canvas-area")!;
    fireEvent.wheel(canvas, { deltaY: -100 });
    expect(screen.getByLabelText("Preview zoom level")).toHaveTextContent(
      "Zoom 113%",
    );
  });

  it("pans the preview canvas with a Space drag", async () => {
    await openEditor();
    const canvas = document.querySelector(".canvas-area")!;
    fireEvent.keyDown(window, { code: "Space" });
    fireEvent.pointerDown(canvas, {
      clientX: 400,
      clientY: 300,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerMove(canvas, {
      clientX: 500,
      clientY: 350,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 1 });
    fireEvent.keyUp(window, { code: "Space" });
    // Panning keeps the zoom level unchanged.
    expect(screen.getByLabelText("Preview zoom level")).toHaveTextContent(
      "Zoom 100%",
    );
  });

  it("pans the viewport by the full drag distance", async () => {
    const { blits, spy } = recordCanvasContext();
    await openEditor();
    const canvas = document.querySelector(".canvas-area")!;
    vi.useFakeTimers();
    fireEvent.keyDown(window, { code: "Space" });
    try {
      fireEvent.pointerDown(canvas, {
        clientX: 100,
        clientY: 100,
        button: 0,
        pointerId: 1,
      });
      fireEvent.pointerMove(canvas, {
        clientX: 400,
        clientY: 100,
        button: 0,
        pointerId: 1,
      });
      fireEvent.pointerMove(canvas, {
        clientX: 450,
        clientY: 100,
        button: 0,
        pointerId: 1,
      });
      vi.advanceTimersByTime(16);
      const before = lastBlitOffset(blits);
      fireEvent.pointerMove(canvas, {
        clientX: 480,
        clientY: 100,
        button: 0,
        pointerId: 1,
      });
      vi.advanceTimersByTime(16);
      const after = lastBlitOffset(blits);
      // A 30px drag must move the content by exactly 30 CSS pixels.
      expect(after - before).toBeCloseTo(30, 5);
    } finally {
      fireEvent.keyUp(window, { code: "Space" });
      vi.useRealTimers();
      spy.mockRestore();
    }
  });

  it("keeps the drag and release positions aligned on high-DPI screens", async () => {
    const { blits, spy } = recordCanvasContext();
    Object.defineProperty(window, "devicePixelRatio", {
      value: 2,
      configurable: true,
    });
    // jsdom has no layout: give canvases a size so the viewport measure
    // runs and records the 2x device pixel ratio.
    const widthSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "clientWidth", "get")
      .mockReturnValue(300);
    const heightSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "clientHeight", "get")
      .mockReturnValue(150);
    await openEditor();
    const canvas = document.querySelector(".canvas-area")!;
    vi.useFakeTimers();
    fireEvent.keyDown(window, { code: "Space" });
    try {
      fireEvent.pointerDown(canvas, {
        clientX: 100,
        clientY: 100,
        button: 0,
        pointerId: 1,
      });
      fireEvent.pointerMove(canvas, {
        clientX: 130,
        clientY: 100,
        button: 0,
        pointerId: 1,
      });
      vi.advanceTimersByTime(16);
      // A 30px drag at dpr 2 must travel 60 device pixels, so the
      // release repaint lands exactly where the drag showed content.
      expect(lastBlitOffset(blits)).toBeCloseTo(60, 5);
      fireEvent.pointerUp(canvas, {
        clientX: 130,
        clientY: 100,
        button: 0,
        pointerId: 1,
      });
      // A second drag from the released position must not accumulate
      // any offset: the pan stays 1:1 across gestures.
      fireEvent.pointerDown(canvas, {
        clientX: 130,
        clientY: 100,
        button: 0,
        pointerId: 1,
      });
      fireEvent.pointerMove(canvas, {
        clientX: 160,
        clientY: 100,
        button: 0,
        pointerId: 1,
      });
      vi.advanceTimersByTime(16);
      expect(lastBlitOffset(blits)).toBeCloseTo(60, 5);
    } finally {
      fireEvent.keyUp(window, { code: "Space" });
      vi.useRealTimers();
      spy.mockRestore();
      widthSpy.mockRestore();
      heightSpy.mockRestore();
      Object.defineProperty(window, "devicePixelRatio", {
        value: 1,
        configurable: true,
      });
    }
  });

  it("does not pan with a plain left drag", async () => {
    const { blits, spy } = recordCanvasContext();
    await openEditor();
    const canvas = document.querySelector(".canvas-area")!;
    vi.useFakeTimers();
    try {
      // Start on empty board space, outside the placeholder frame.
      fireEvent.pointerDown(canvas, {
        clientX: 60,
        clientY: 140,
        button: 0,
        pointerId: 1,
      });
      fireEvent.pointerMove(canvas, {
        clientX: 200,
        clientY: 140,
        button: 0,
        pointerId: 1,
      });
      vi.advanceTimersByTime(50);
      fireEvent.pointerUp(canvas, { button: 0, pointerId: 1 });
      expect(panBlitCount(blits)).toBe(0);
    } finally {
      vi.useRealTimers();
      spy.mockRestore();
    }
  });

  it("drags the poster sheet with the left button", async () => {
    const { blits, spy } = recordCanvasContext();
    // Give the canvas a size so the placeholder frame has a real place.
    const widthSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "clientWidth", "get")
      .mockReturnValue(300);
    const heightSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "clientHeight", "get")
      .mockReturnValue(150);
    await openEditor();
    const canvas = document.querySelector(".canvas-area")!;
    vi.useFakeTimers();
    try {
      // (150, 75) lands inside the placeholder frame.
      fireEvent.pointerDown(canvas, {
        clientX: 150,
        clientY: 75,
        button: 0,
        pointerId: 1,
      });
      expect((canvas as HTMLCanvasElement).style.cursor).toBe("move");
      fireEvent.pointerMove(canvas, {
        clientX: 180,
        clientY: 90,
        button: 0,
        pointerId: 1,
      });
      vi.advanceTimersByTime(16);
      // The sheet drag shifts the cached frame, exactly like a pan.
      expect(panBlitCount(blits)).toBeGreaterThan(0);
      fireEvent.pointerUp(canvas, { button: 0, pointerId: 1 });
      expect((canvas as HTMLCanvasElement).style.cursor).toBe("");
    } finally {
      vi.useRealTimers();
      spy.mockRestore();
      widthSpy.mockRestore();
      heightSpy.mockRestore();
    }
  });

  it("re-renders the exposed strip so cut-off objects come into view", async () => {
    const { blits, rects, clips, spy } = recordCanvasContext();
    await openEditor();
    const canvas = document.querySelector(".canvas-area")!;
    vi.useFakeTimers();
    fireEvent.keyDown(window, { code: "Space" });
    try {
      fireEvent.pointerDown(canvas, {
        clientX: 100,
        clientY: 100,
        button: 0,
        pointerId: 1,
      });
      fireEvent.pointerMove(canvas, {
        clientX: 130,
        clientY: 100,
        button: 0,
        pointerId: 1,
      });
      vi.advanceTimersByTime(16);
      // The pan still blits the snapshot 1:1...
      expect(lastBlitOffset(blits)).toBeCloseTo(30, 5);
      // ...and re-renders the 30px strip the snapshot no longer covers
      // on the left edge instead of leaving bare background.
      expect(rects).toContainEqual([0, 0, 30, 150]);
      expect(clips.length).toBeGreaterThan(0);
    } finally {
      fireEvent.keyUp(window, { code: "Space" });
      vi.useRealTimers();
      spy.mockRestore();
    }
  });

  it("caps the pan repaints at the configured max FPS", async () => {
    mockedInvoke.mockImplementation((command: string) => {
      if (command === "get_app_settings") {
        return Promise.resolve({
          ...defaultGlobalSettings(),
          vsync: false,
          maxFps: 30,
        });
      }
      return Promise.resolve(undefined);
    });
    const { blits, spy } = recordCanvasContext();
    await openEditor();
    const canvas = document.querySelector(".canvas-area")!;
    vi.useFakeTimers();
    fireEvent.keyDown(window, { code: "Space" });
    try {
      fireEvent.pointerDown(canvas, {
        clientX: 100,
        clientY: 100,
        button: 0,
        pointerId: 1,
      });
      fireEvent.pointerMove(canvas, {
        clientX: 200,
        clientY: 100,
        button: 0,
        pointerId: 1,
      });
      // 16ms is inside the 33ms interval of a 30 FPS cap: no repaint yet.
      vi.advanceTimersByTime(16);
      expect(panBlitCount(blits)).toBe(0);
      // The timer fires after 33ms and paints the full 100px of travel.
      vi.advanceTimersByTime(17);
      expect(panBlitCount(blits)).toBe(1);
      expect(lastBlitOffset(blits)).toBeCloseTo(100, 5);
    } finally {
      fireEvent.keyUp(window, { code: "Space" });
      vi.useRealTimers();
      spy.mockRestore();
    }
  });

  it("does not zoom while wheeling over the prompt", async () => {
    await openEditor();
    const prompt = screen.getByRole("textbox", { name: "Poster prompt" });
    fireEvent.wheel(prompt, { deltaY: -100 });
    expect(screen.getByLabelText("Preview zoom level")).toHaveTextContent(
      "Zoom 100%",
    );
  });

  it("sends dropped references with the prompt", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation((command) => {
      if (command === "get_app_settings") {
        return Promise.resolve(null);
      }
      if (command === "read_reference_images") {
        return Promise.resolve([
          { name: "mood.png", mimeType: "image/png", dataBase64: "bW9vZA==" },
        ]);
      }
      if (command === "agent_run") {
        return Promise.resolve({
          document: { width: 1024, height: 1536, sheetX: 0, sheetY: 0, layers: [] },
          events: [],
        });
      }
      return Promise.resolve(null);
    });
    await openEditor();
    dropImage();
    // The moodboard shows the dropped reference in the island.
    await waitFor(() => expect(screen.getByAltText("mood.png")).toBeInTheDocument());
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    await user.type(input, "poster");
    await user.click(screen.getByRole("button", { name: "Generate poster" }));
    await waitFor(() =>
      expect(
        mockedInvoke.mock.calls.some((call) => call[0] === "agent_run"),
      ).toBe(true),
    );
    const agentCall = mockedInvoke.mock.calls.find(
      (call) => call[0] === "agent_run",
    );
    const args = agentCall![1] as {
      request: { references: { name: string; mimeType: string }[] };
    };
    expect(args.request.references).toHaveLength(1);
    expect(args.request.references[0].name).toBe("mood.png");
    expect(args.request.references[0].mimeType).toBe("image/png");
  });

  it("sends the project settings with the agent request", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "get_app_settings") {
        return null;
      }
      if (command === "agent_run") {
        return {
          document: { width: 1024, height: 1536, sheetX: 0, sheetY: 0, layers: [] },
          events: [],
        };
      }
      return null;
    });
    await openEditor();
    await user.click(
      screen.getByRole("button", { name: "Generation settings" }),
    );
    await screen.findByRole("dialog", { name: "Project settings" });
    const steps = screen.getByLabelText("Steps");
    await user.clear(steps);
    await user.type(steps, "15");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    await user.type(input, "poster");
    await user.click(screen.getByRole("button", { name: "Generate poster" }));
    await waitFor(() =>
      expect(
        mockedInvoke.mock.calls.some((call) => call[0] === "agent_run"),
      ).toBe(true),
    );
    const agentCall = mockedInvoke.mock.calls.find(
      (call) => call[0] === "agent_run",
    );
    const args = agentCall![1] as { request: { params: { steps: number } } };
    expect(args.request.params.steps).toBe(15);
  });

  it("shows the agent error in the chat bubble", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "get_app_settings") {
        return null;
      }
      if (command === "agent_run") {
        throw "connection refused";
      }
      return null;
    });
    await openEditor();
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    await user.type(input, "poster");
    await user.click(screen.getByRole("button", { name: "Generate poster" }));
    expect(
      await screen.findByText("connection refused"),
    ).toBeInTheDocument();
  });

  it("disables the input while the agent runs", async () => {
    const user = userEvent.setup();
    let resolveInvoke: (value: unknown) => void = () => {};
    mockedInvoke.mockImplementation((command) => {
      if (command === "get_app_settings") {
        return Promise.resolve(null);
      }
      if (command === "agent_run") {
        return new Promise((resolve) => {
          resolveInvoke = resolve;
        });
      }
      return Promise.resolve(null);
    });
    await openEditor();
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    await user.type(input, "poster");
    await user.click(screen.getByRole("button", { name: "Generate poster" }));
    expect(input).toBeDisabled();
    await act(async () => {
      resolveInvoke({
        document: { width: 1024, height: 1536, sheetX: 0, sheetY: 0, layers: [] },
        events: [],
      });
    });
    expect(input).toBeEnabled();
  });
});
