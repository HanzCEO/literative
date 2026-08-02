import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { MoodboardProvider } from "../state/MoodboardContext";
import { FloatingIsland } from "./FloatingIsland";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));
const { onDragDropEvent } = vi.hoisted(() => ({ onDragDropEvent: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent }),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedOpen = vi.mocked(open);

beforeEach(() => {
  mockedInvoke.mockReset();
  localStorage.clear();
  mockedOpen.mockReset();
  onDragDropEvent.mockReset();
  onDragDropEvent.mockResolvedValue(vi.fn());
});

function renderIsland(onRun: (prompt: string) => void = vi.fn()) {
  return render(
    <MoodboardProvider>
      <FloatingIsland
        onRun={onRun}
        onOpenSettings={vi.fn()}
      />
    </MoodboardProvider>,
  );
}

function imageFile(name: string): File {
  return new File(["fake-image-bytes"], name, { type: "image/png" });
}

/** Get the handler registered with the Tauri webview. */
type DragDropPayload =
  | { type: "enter"; paths: string[]; position: { x: number; y: number } }
  | { type: "over"; position: { x: number; y: number } }
  | { type: "drop"; paths: string[]; position: { x: number; y: number } }
  | { type: "leave" };

function dragDropHandler(): (event: { payload: DragDropPayload }) => void {
  expect(onDragDropEvent).toHaveBeenCalledOnce();
  return onDragDropEvent.mock.calls[0][0];
}

/** Fire a drop payload at the registered Tauri drag-drop handler. */
function dropPaths(paths: string[]) {
  const handler = dragDropHandler();
  act(() => {
    handler({
      payload: { type: "drop", paths, position: { x: 10, y: 10 } },
    });
  });
}

describe("FloatingIsland", () => {
  it("renders the prompt input", () => {
    renderIsland();
    expect(
      screen.getByRole("textbox", { name: "Poster prompt" }),
    ).toBeInTheDocument();
  });

  it("accepts typed prompts", async () => {
    const user = userEvent.setup();
    renderIsland();
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    await user.type(input, "A bold concert poster");
    expect(input).toHaveValue("A bold concert poster");
  });

  it("is disabled for submit when empty", () => {
    renderIsland();
    expect(
      screen.getByRole("button", { name: "Generate poster" }),
    ).toBeDisabled();
  });

  it("submits the prompt", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    renderIsland(onRun);
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    await user.type(input, "Retro travel poster");
    await user.click(screen.getByRole("button", { name: "Generate poster" }));
    expect(onRun).toHaveBeenCalledWith("Retro travel poster");
  });

  it("recalls the previous prompt with the arrow up key", async () => {
    const user = userEvent.setup();
    renderIsland();
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    await user.type(input, "A jazz poster");
    await user.click(screen.getByRole("button", { name: "Generate poster" }));
    expect(input).toHaveValue("");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveValue("A jazz poster");
  });

  it("cycles back through the prompt history", async () => {
    const user = userEvent.setup();
    renderIsland();
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    await user.type(input, "first poster");
    await user.click(screen.getByRole("button", { name: "Generate poster" }));
    await user.type(input, "second poster");
    await user.click(screen.getByRole("button", { name: "Generate poster" }));
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveValue("second poster");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveValue("first poster");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    // The oldest entry is the floor of the walk.
    expect(input).toHaveValue("first poster");
  });

  it("returns to the live draft with the arrow down key", async () => {
    const user = userEvent.setup();
    renderIsland();
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    await user.type(input, "a poster");
    await user.click(screen.getByRole("button", { name: "Generate poster" }));
    await user.type(input, "draft text");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveValue("a poster");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveValue("draft text");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    // Already on the live draft; the walk stays put.
    expect(input).toHaveValue("draft text");
  });

  it("keeps the prompt history after a remount", async () => {
    const user = userEvent.setup();
    const first = renderIsland();
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    await user.type(input, "persisted poster");
    await user.click(screen.getByRole("button", { name: "Generate poster" }));
    first.unmount();

    renderIsland();
    const newInput = screen.getByRole("textbox", { name: "Poster prompt" });
    fireEvent.keyDown(newInput, { key: "ArrowUp" });
    expect(newInput).toHaveValue("persisted poster");
  });

  it("skips a repeated consecutive prompt in the history", async () => {
    const user = userEvent.setup();
    renderIsland();
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    await user.type(input, "repeat poster");
    await user.click(screen.getByRole("button", { name: "Generate poster" }));
    await user.type(input, "repeat poster");
    await user.click(screen.getByRole("button", { name: "Generate poster" }));
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveValue("repeat poster");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    // The duplicate did not create a second history entry.
    expect(input).toHaveValue("repeat poster");
  });

  it("adds dropped image paths to the moodboard", async () => {
    mockedInvoke.mockResolvedValue([
      { name: "one.png", mimeType: "image/png", dataBase64: "b25l" },
      { name: "two.png", mimeType: "image/png", dataBase64: "dHdv" },
    ]);
    renderIsland();
    dropPaths(["/tmp/one.png", "/tmp/two.png"]);
    await waitFor(() =>
      expect(screen.getByTestId("moodboard")).toBeInTheDocument(),
    );
    expect(mockedInvoke).toHaveBeenCalledWith("read_reference_images", {
      paths: ["/tmp/one.png", "/tmp/two.png"],
    });
    expect(screen.getByAltText("one.png")).toBeInTheDocument();
    expect(screen.getByAltText("two.png")).toBeInTheDocument();
  });

  it("shows the dragging state while files hover the window", () => {
    renderIsland();
    const handler = dragDropHandler();
    act(() => {
      handler({ payload: { type: "over", position: { x: 10, y: 10 } } });
    });
    expect(screen.getByTestId("floating-island")).toHaveClass(
      "island-dragging",
    );
    act(() => {
      handler({ payload: { type: "leave" } });
    });
    expect(screen.getByTestId("floating-island")).not.toHaveClass(
      "island-dragging",
    );
  });

  it("ignores dropped non-image paths", () => {
    renderIsland();
    dropPaths(["/tmp/notes.txt", "/tmp/archive.tar.gz"]);
    expect(mockedInvoke).not.toHaveBeenCalled();
    expect(screen.queryByTestId("moodboard")).not.toBeInTheDocument();
  });

  it("removes a reference with its remove button", async () => {
    mockedInvoke.mockResolvedValue([
      { name: "one.png", mimeType: "image/png", dataBase64: "b25l" },
    ]);
    renderIsland();
    dropPaths(["/tmp/one.png"]);
    await waitFor(() =>
      expect(screen.getByTestId("moodboard")).toBeInTheDocument(),
    );
    const remove = screen.getByRole("button", { name: "Remove one.png" });
    fireEvent.click(remove);
    expect(screen.queryByTestId("moodboard")).not.toBeInTheDocument();
  });

  it("stays disabled with only a reference, no prompt", async () => {
    mockedInvoke.mockResolvedValue([
      { name: "one.png", mimeType: "image/png", dataBase64: "b25l" },
    ]);
    renderIsland();
    dropPaths(["/tmp/one.png"]);
    await waitFor(() =>
      expect(screen.getByTestId("moodboard")).toBeInTheDocument(),
    );
    // The agent needs a prompt; references alone do not enable submit.
    expect(
      screen.getByRole("button", { name: "Generate poster" }),
    ).toBeDisabled();
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    await userEvent.setup().type(input, "poster");
    expect(
      screen.getByRole("button", { name: "Generate poster" }),
    ).toBeEnabled();
  });

  it("adds picked images through the native file dialog", async () => {
    const user = userEvent.setup();
    mockedOpen.mockResolvedValue(["/tmp/one.png", "/tmp/two.png"]);
    mockedInvoke.mockResolvedValue([
      { name: "one.png", mimeType: "image/png", dataBase64: "b25l" },
      { name: "two.png", mimeType: "image/png", dataBase64: "dHdv" },
    ]);
    renderIsland();
    await user.click(
      screen.getByRole("button", { name: "Add reference images" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("moodboard")).toBeInTheDocument(),
    );
    expect(mockedOpen).toHaveBeenCalledWith(
      expect.objectContaining({ multiple: true }),
    );
    expect(mockedInvoke).toHaveBeenCalledWith("read_reference_images", {
      paths: ["/tmp/one.png", "/tmp/two.png"],
    });
    expect(screen.getByAltText("one.png")).toBeInTheDocument();
    expect(screen.getByAltText("two.png")).toBeInTheDocument();
  });

  it("does nothing when the file dialog is cancelled", async () => {
    const user = userEvent.setup();
    mockedOpen.mockResolvedValue(null);
    renderIsland();
    await user.click(
      screen.getByRole("button", { name: "Add reference images" }),
    );
    expect(screen.queryByTestId("moodboard")).not.toBeInTheDocument();
  });

  it("adds a pasted image from the clipboard", () => {
    renderIsland();
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    fireEvent.paste(input, {
      clipboardData: { files: [imageFile("clip.png")] },
    });
    expect(screen.getByAltText("clip.png")).toBeInTheDocument();
    expect(screen.getByTestId("moodboard")).toBeInTheDocument();
  });

  it("ignores pasted text", () => {
    renderIsland();
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    fireEvent.paste(input, {
      clipboardData: {
        files: [new File(["x"], "notes.txt", { type: "text/plain" })],
      },
    });
    expect(screen.queryByTestId("moodboard")).not.toBeInTheDocument();
  });
});
