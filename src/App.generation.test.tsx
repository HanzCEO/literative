import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
const { onDragDropEvent } = vi.hoisted(() => ({ onDragDropEvent: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent }),
}));

const mockedInvoke = vi.mocked(invoke);

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

  it("displays the generated poster on the canvas", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockResolvedValue({
      dataUrl: "data:image/png;base64,Z2VuZXJhdGVk",
      width: 1024,
      height: 1024,
    });
    await openEditor();
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    await user.type(input, "A neon jazz poster");
    await user.click(screen.getByRole("button", { name: "Generate poster" }));

    const poster = await screen.findByTestId("result-overlay");
    expect(poster).toBeInTheDocument();
    expect(screen.getByText("1024 x 1024 px")).toBeInTheDocument();
    // The generated result replaces the empty poster frame.
    expect(
      screen.queryByRole("img", { name: /Poster base canvas/ }),
    ).not.toBeInTheDocument();
    expect(mockedInvoke).toHaveBeenCalledWith(
      "generate_poster",
      expect.objectContaining({ prompt: "A neon jazz poster" }),
    );
  });

  it("zooms the preview canvas with the wheel", async () => {
    await openEditor();
    const canvas = document.querySelector(".canvas-area")!;
    fireEvent.wheel(canvas, { deltaY: -100 });
    expect(screen.getByLabelText("Preview zoom level")).toHaveTextContent(
      "Zoom 113%",
    );
  });

  it("pans the preview canvas by dragging", async () => {
    await openEditor();
    const canvas = document.querySelector(".canvas-area")!;
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
    // Panning keeps the zoom level unchanged.
    expect(screen.getByLabelText("Preview zoom level")).toHaveTextContent(
      "Zoom 100%",
    );
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
      return Promise.resolve({
        dataUrl: "data:image/png;base64,xxx",
        width: 1,
        height: 1,
      });
    });
    await openEditor();
    dropImage();
    // The moodboard shows the dropped reference in the island.
    await waitFor(() => expect(screen.getByAltText("mood.png")).toBeInTheDocument());
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    await user.type(input, "poster");
    await user.click(screen.getByRole("button", { name: "Generate poster" }));
    await screen.findByTestId("result-overlay");
    const generateCall = mockedInvoke.mock.calls.find(
      (call) => call[0] === "generate_poster",
    );
    const args = generateCall![1] as {
      prompt: string;
      references: { name: string; mimeType: string }[];
    };
    expect(args.references).toHaveLength(1);
    expect(args.references[0].name).toBe("mood.png");
    expect(args.references[0].mimeType).toBe("image/png");
  });

  it("sends the project settings with the generation request", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockResolvedValue({
      dataUrl: "data:image/png;base64,xxx",
      width: 1,
      height: 1,
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
    await screen.findByTestId("result-overlay");
    const generateCall = mockedInvoke.mock.calls.find(
      (call) => call[0] === "generate_poster",
    );
    const args = generateCall![1] as { params: { steps: number } };
    expect(args.params.steps).toBe(15);
  });

  it("shows the error message when generation fails", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockRejectedValue(new Error("connection refused"));
    await openEditor();
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    await user.type(input, "poster");
    await user.click(screen.getByRole("button", { name: "Generate poster" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("connection refused"),
    );
    expect(screen.queryByTestId("result-overlay")).not.toBeInTheDocument();
  });

  it("dismisses the poster with its close button", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockResolvedValue({
      dataUrl: "data:image/png;base64,xxx",
      width: 512,
      height: 512,
    });
    await openEditor();
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    await user.type(input, "poster");
    await user.click(screen.getByRole("button", { name: "Generate poster" }));
    await screen.findByTestId("result-overlay");
    await user.click(screen.getByRole("button", { name: "Dismiss poster" }));
    await waitFor(() =>
      expect(screen.queryByTestId("result-overlay")).not.toBeInTheDocument(),
    );
    // The empty poster frame returns to the center stage.
    expect(
      screen.getByRole("img", { name: "Poster base canvas 1024 by 1536 pixels" }),
    ).toBeInTheDocument();
  });

  it("disables the input while generating", async () => {
    const user = userEvent.setup();
    let resolveInvoke: (value: unknown) => void = () => {};
    mockedInvoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInvoke = resolve;
        }),
    );
    await openEditor();
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    await user.type(input, "poster");
    await user.click(screen.getByRole("button", { name: "Generate poster" }));
    expect(input).toBeDisabled();
    resolveInvoke({ dataUrl: "data:image/png;base64,x", width: 1, height: 1 });
    await screen.findByTestId("result-overlay");
  });
});
