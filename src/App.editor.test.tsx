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

  it("returns to the island view with Done", async () => {
    const user = userEvent.setup();
    await enterEditor();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(
      screen.getByRole("textbox", { name: "Poster prompt" }),
    ).toBeInTheDocument();
  });
});
