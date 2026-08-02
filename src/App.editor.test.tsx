import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedSave = vi.mocked(save);

/** Replace the canvas 2D context with a stub that records transforms. */
function recordEditorTransforms() {
  const transforms: number[][] = [];
  const target: Record<string, unknown> = {
    setTransform: (...args: number[]) => transforms.push(args),
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
  return { transforms, spy };
}

/** Horizontal offset (e component) of the latest content transform. */
function lastTransformOffset(transforms: number[][]): number {
  const last = transforms[transforms.length - 1];
  return (last?.[4] as number) ?? 0;
}

/** Create a project through onboarding and wait for the editor. */
async function openEditor() {
  render(<App />);
  await userEvent.click(
    screen.getAllByRole("button", { name: "New project" })[0],
  );
  await userEvent.type(
    screen.getByLabelText("Project name"),
    "Test project",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Create project" }),
  );
  await screen.findByRole("textbox", { name: "Poster prompt" });
}

async function enterEditor() {
  mockedInvoke.mockResolvedValue({
    dataUrl: "data:image/png;base64,cG9zdGVy",
    width: 800,
    height: 600,
  });
  await openEditor();
  const input = screen.getByRole("textbox", { name: "Poster prompt" });
  await userEvent.type(input, "a poster");
  await userEvent.click(screen.getByRole("button", { name: "Generate poster" }));
  await screen.findByTestId("result-overlay");
  await userEvent.click(screen.getByRole("button", { name: "Edit poster" }));
  await screen.findByRole("button", { name: "Add text" });
}

describe("poster editor", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedSave.mockReset();
  });

  it("shows the poster base frame at the project poster size", async () => {
    await openEditor();
    expect(screen.getByTestId("canvas-area")).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "Poster base canvas 1024 by 1536 pixels",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("1024 x 1536 px")).toBeInTheDocument();
  });

  it("shows a poster frame at a custom project size", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getAllByRole("button", { name: "New project" })[0],
    );
    await user.type(
      screen.getByLabelText("Project name"),
      "Custom size project",
    );
    const widthInput = screen.getByLabelText("Poster width in pixels");
    await user.clear(widthInput);
    await user.type(widthInput, "800");
    const heightInput = screen.getByLabelText("Poster height in pixels");
    await user.clear(heightInput);
    await user.type(heightInput, "600");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await screen.findByRole("textbox", { name: "Poster prompt" });
    expect(
      screen.getByRole("img", {
        name: "Poster base canvas 800 by 600 pixels",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("800 x 600 px")).toBeInTheDocument();
  });

  it("opens with the generated poster as the base layer", async () => {
    await enterEditor();
    expect(screen.getByTestId("canvas-area")).toBeInTheDocument();
    expect(screen.getByText("Generated poster")).toBeInTheDocument();
    // The document uses the project poster size, not the image size.
    expect(screen.getByText("1024 x 1536 px")).toBeInTheDocument();
  });

  it("adds and edits a text layer", async () => {
    const user = userEvent.setup();
    await enterEditor();
    await user.click(screen.getByRole("button", { name: "Add text" }));
    await waitFor(() =>
      expect(screen.getAllByText("Text layer").length).toBeGreaterThan(0),
    );
    const textInput = screen.getByRole("textbox", { name: "Layer text" });
    await user.clear(textInput);
    await user.type(textInput, "Hello world");
    expect(textInput).toHaveValue("Hello world");
  });

  it("adjusts layer opacity through the slider", async () => {
    const user = userEvent.setup();
    await enterEditor();
    await user.click(screen.getByRole("button", { name: "Add text" }));
    const slider = screen.getByRole("slider", { name: "Layer opacity" });
    expect(slider).toHaveValue("100");
    fireEvent.change(slider, { target: { value: "40" } });
    expect(slider).toHaveValue("40");
  });

  it("switches the blend mode", async () => {
    const user = userEvent.setup();
    await enterEditor();
    await user.click(screen.getByRole("button", { name: "Add text" }));
    const select = screen.getByRole("combobox", { name: "Blend mode" });
    await user.selectOptions(select, "multiply");
    expect(select).toHaveValue("multiply");
  });

  it("reorders and deletes layers", async () => {
    const user = userEvent.setup();
    await enterEditor();
    await user.click(screen.getByRole("button", { name: "Add text" }));
    await user.click(screen.getByRole("button", { name: "Add text" }));
    const rows = screen.getAllByTestId(/^layer-row-layer-/);
    expect(rows).toHaveLength(3); // base image + two text layers
    const firstRowId = rows[0].dataset.testid;
    await user.click(
      screen.getAllByRole("button", { name: "Move Text layer down" })[0],
    );
    const rowsAfter = screen.getAllByTestId(/^layer-row-layer-/);
    expect(rowsAfter[0].dataset.testid).not.toBe(firstRowId);
    const deleteButtons = screen.getAllByRole("button", {
      name: /Delete Text layer/,
    });
    await user.click(deleteButtons[0]);
    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: /Delete Text layer/ }),
      ).toHaveLength(1);
    });
  });

  it("toggles layer visibility", async () => {
    const user = userEvent.setup();
    await enterEditor();
    await user.click(screen.getByRole("button", { name: "Add text" }));
    await user.click(
      screen.getByRole("button", { name: "Toggle visibility of Text layer" }),
    );
    expect(
      screen.getByRole("button", { name: "Toggle visibility of Text layer" }),
    ).toBeInTheDocument();
  });

  it("exports a PNG through the backend", async () => {
    const user = userEvent.setup();
    await enterEditor();
    await user.click(screen.getByRole("button", { name: "Add text" }));
    mockedSave.mockResolvedValue("/tmp/poster.png");
    mockedInvoke.mockResolvedValue({ path: "/tmp/poster.png" });
    await user.click(screen.getByRole("button", { name: "Export PNG" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Exported to /tmp/poster.png",
      ),
    );
    expect(mockedSave).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "poster.png" }),
    );
    const exportCall = mockedInvoke.mock.calls.find(
      (call) => call[0] === "export_poster_to_file",
    );
    expect(exportCall).toBeDefined();
    const args = exportCall![1] as {
      format: string;
      quality: number;
      textLayers: unknown[];
    };
    expect(args.format).toBe("png");
    expect(args.quality).toBe(92);
    expect(args.textLayers).toHaveLength(1);
  });

  it("skips export when the save dialog is cancelled", async () => {
    const user = userEvent.setup();
    await enterEditor();
    mockedSave.mockResolvedValue(null);
    await user.click(screen.getByRole("button", { name: "Export JPG" }));
    await waitFor(() => {
      const exportCall = mockedInvoke.mock.calls.find(
        (call) => call[0] === "export_poster_to_file",
      );
      expect(exportCall).toBeUndefined();
    });
  });

  it("shows the zoom level and document size together in the toolbar center", async () => {
    await enterEditor();
    const center = screen.getByLabelText("Zoom level").parentElement;
    expect(center).not.toBeNull();
    expect(center).toHaveTextContent("Zoom 100%");
    expect(center).toHaveTextContent("1024 x 1536 px");
  });

  it("zooms in with the Ctrl plus key", async () => {
    await enterEditor();
    fireEvent.keyDown(window, { key: "=", ctrlKey: true });
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("Zoom 125%");
  });

  it("zooms out with the Ctrl minus key", async () => {
    await enterEditor();
    fireEvent.keyDown(window, { key: "-", ctrlKey: true });
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("Zoom 80%");
  });

  it("resets zoom with the Ctrl 0 key", async () => {
    await enterEditor();
    fireEvent.keyDown(window, { key: "=", ctrlKey: true });
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("Zoom 125%");
    fireEvent.keyDown(window, { key: "0", ctrlKey: true });
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("Zoom 100%");
  });

  it("zooms with the Ctrl wheel", async () => {
    await enterEditor();
    const canvas = document.querySelector(".canvas-area");
    expect(canvas).not.toBeNull();
    fireEvent.wheel(canvas!, { deltaY: -100, ctrlKey: true });
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("Zoom 113%");
  });

  it("zooms with the plain wheel", async () => {
    await enterEditor();
    const canvas = document.querySelector(".canvas-area");
    expect(canvas).not.toBeNull();
    // Plain wheel needs no modifier, so no webview can intercept it.
    fireEvent.wheel(canvas!, { deltaY: -100 });
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("Zoom 113%");
    fireEvent.wheel(canvas!, { deltaY: 100 });
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("Zoom 100%");
  });

  it("zooms with event.code on non-US layouts", async () => {
    await enterEditor();
    fireEvent.keyDown(window, { code: "Equal", ctrlKey: true });
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("Zoom 125%");
    fireEvent.keyDown(window, { code: "Minus", ctrlKey: true });
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("Zoom 100%");
    fireEvent.keyDown(window, { code: "NumpadAdd", ctrlKey: true });
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("Zoom 125%");
    fireEvent.keyDown(window, { code: "Digit0", ctrlKey: true });
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("Zoom 100%");
  });

  it("zooms with line-mode wheel deltas", async () => {
    await enterEditor();
    const canvas = document.querySelector(".canvas-area");
    expect(canvas).not.toBeNull();
    // WebKitGTK reports line deltas; one line must still zoom visibly.
    fireEvent.wheel(canvas!, { deltaY: -3, deltaMode: 1 });
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("Zoom 106%");
  });

  it("zooms through the toolbar buttons", async () => {
    const user = userEvent.setup();
    await enterEditor();
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("Zoom 125%");
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("Zoom 100%");
  });

  it("zooms with plain plus, minus, and zero keys", async () => {
    await enterEditor();
    // Plain keys carry no modifier, so no GTK or WebKit accelerator can
    // intercept them even where the webview eats the Ctrl combos.
    fireEvent.keyDown(window, { key: "+", code: "Equal" });
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("Zoom 125%");
    fireEvent.keyDown(window, { key: "-", code: "Minus" });
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("Zoom 100%");
    fireEvent.keyDown(window, { key: "+", code: "Equal" });
    fireEvent.keyDown(window, { key: "0", code: "Digit0" });
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("Zoom 100%");
  });

  it("does not zoom while typing in layer fields", async () => {
    const user = userEvent.setup();
    await enterEditor();
    await user.click(screen.getByRole("button", { name: "Add text" }));
    const textInput = await screen.findByLabelText("Layer text");
    await user.type(textInput, "+0");
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("Zoom 100%");
  });

  it("pans the viewport with space drag", async () => {
    await enterEditor();
    const canvas = document.querySelector(".canvas-area")!;
    // Select the generated poster layer through the layer panel.
    const rows = screen.getAllByTestId(/layer-row-/);
    await userEvent.click(rows[0]);
    expect(rows[0]).toHaveClass("layer-row-selected");
    fireEvent.keyDown(window, { code: "Space" });
    fireEvent.pointerDown(canvas, {
      clientX: 400,
      clientY: 300,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerMove(canvas, {
      clientX: 520,
      clientY: 360,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 1 });
    fireEvent.keyUp(window, { code: "Space" });
    // The viewport panned: the layer stayed selected and unmoved.
    expect(rows[0]).toHaveClass("layer-row-selected");
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("Zoom 100%");
  });

  it("ignores the middle button", async () => {
    await enterEditor();
    const canvas = document.querySelector(".canvas-area")!;
    const rows = screen.getAllByTestId(/layer-row-/);
    await userEvent.click(rows[0]);
    expect(rows[0]).toHaveClass("layer-row-selected");
    fireEvent.pointerDown(canvas, {
      clientX: 400,
      clientY: 300,
      button: 1,
      pointerId: 1,
    });
    fireEvent.pointerMove(canvas, {
      clientX: 460,
      clientY: 340,
      button: 1,
      pointerId: 1,
    });
    fireEvent.pointerUp(canvas, { button: 1, pointerId: 1 });
    // The middle button never pans: no grab cursor, selection untouched.
    expect((canvas as HTMLCanvasElement).style.cursor).toBe("");
    expect(rows[0]).toHaveClass("layer-row-selected");
  });

  it("selects and drags the poster sheet", async () => {
    const user = userEvent.setup();
    // Give the canvas a size so hit-testing maps to document space.
    const widthSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "clientWidth", "get")
      .mockReturnValue(300);
    const heightSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "clientHeight", "get")
      .mockReturnValue(150);
    await enterEditor();
    const canvas = document.querySelector(".canvas-area")!;
    // Select the base layer first; clicking the sheet must clear it.
    const rows = screen.getAllByTestId(/layer-row-/);
    await user.click(rows[0]);
    expect(rows[0]).toHaveClass("layer-row-selected");
    // (150, 100) maps inside the sheet but below the 1024x768 image.
    fireEvent.pointerDown(canvas, {
      clientX: 150,
      clientY: 100,
      button: 0,
      pointerId: 1,
    });
    expect((canvas as HTMLCanvasElement).style.cursor).toBe("move");
    fireEvent.pointerMove(canvas, {
      clientX: 180,
      clientY: 130,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 1 });
    expect((canvas as HTMLCanvasElement).style.cursor).toBe("");
    // The sheet click cleared the layer selection.
    expect(rows[0]).not.toHaveClass("layer-row-selected");
    widthSpy.mockRestore();
    heightSpy.mockRestore();
  });

  it("keeps the sheet position across later document edits", async () => {
    const { transforms, spy } = recordEditorTransforms();
    const widthSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "clientWidth", "get")
      .mockReturnValue(300);
    const heightSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "clientHeight", "get")
      .mockReturnValue(150);
    await enterEditor();
    const canvas = document.querySelector(".canvas-area")!;
    vi.useFakeTimers();
    try {
      // Drag the sheet right by 30 CSS pixels from inside the frame.
      fireEvent.pointerDown(canvas, {
        clientX: 150,
        clientY: 100,
        button: 0,
        pointerId: 1,
      });
      fireEvent.pointerMove(canvas, {
        clientX: 180,
        clientY: 130,
        button: 0,
        pointerId: 1,
      });
      vi.advanceTimersByTime(16);
      fireEvent.pointerUp(canvas, { button: 0, pointerId: 1 });
      const afterDrag = lastTransformOffset(transforms);
      // A later document edit must not snap the sheet back to center.
      fireEvent.click(screen.getByRole("button", { name: "Add text" }));
      expect(lastTransformOffset(transforms)).toBeCloseTo(afterDrag, 5);
    } finally {
      vi.useRealTimers();
      spy.mockRestore();
      widthSpy.mockRestore();
      heightSpy.mockRestore();
    }
  });

  it("keeps the sheet position when double-clicking empty board", async () => {
    const { transforms, spy } = recordEditorTransforms();
    const widthSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "clientWidth", "get")
      .mockReturnValue(300);
    const heightSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "clientHeight", "get")
      .mockReturnValue(150);
    await enterEditor();
    const canvas = document.querySelector(".canvas-area")!;
    vi.useFakeTimers();
    try {
      // Drag the sheet right by 30 CSS pixels from inside the frame.
      fireEvent.pointerDown(canvas, {
        clientX: 150,
        clientY: 100,
        button: 0,
        pointerId: 1,
      });
      fireEvent.pointerMove(canvas, {
        clientX: 180,
        clientY: 130,
        button: 0,
        pointerId: 1,
      });
      vi.advanceTimersByTime(16);
      fireEvent.pointerUp(canvas, { button: 0, pointerId: 1 });
      const afterDrag = lastTransformOffset(transforms);
      // Double-click on empty board space far outside the sheet.
      fireEvent.dblClick(canvas, { clientX: 30, clientY: 300 });
      // The view reset must not move the sheet back to the center.
      expect(lastTransformOffset(transforms)).toBeCloseTo(afterDrag, 5);
    } finally {
      vi.useRealTimers();
      spy.mockRestore();
      widthSpy.mockRestore();
      heightSpy.mockRestore();
    }
  });

  it("deselects when dragging empty space", async () => {
    await enterEditor();
    const rows = screen.getAllByTestId(/layer-row-/);
    await userEvent.click(rows[0]);
    expect(rows[0]).toHaveClass("layer-row-selected");
    const canvas = document.querySelector(".canvas-area")!;
    // Drag from a point far outside the poster sheet.
    fireEvent.pointerDown(canvas, {
      clientX: 30,
      clientY: 300,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerMove(canvas, {
      clientX: 80,
      clientY: 330,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 1 });
    expect(rows[0]).not.toHaveClass("layer-row-selected");
  });

  it("does not zoom while the settings dialog is open", async () => {
    await enterEditor();
    await userEvent.click(
      screen.getByRole("button", { name: "Open settings" }),
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.wheel(dialog, { deltaY: -100 });
    // The wheel over the modal scrolls it; it must not zoom the board.
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent(
      "Zoom 100%",
    );
  });

  it("returns to the island view with Done", async () => {
    const user = userEvent.setup();
    await enterEditor();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(
      screen.getByRole("textbox", { name: "Poster prompt" }),
    ).toBeInTheDocument();
  });
});
