import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const mockedInvoke = vi.mocked(invoke);
const mockedOpen = vi.mocked(open);

beforeEach(() => {
  mockedInvoke.mockReset();
  mockedOpen.mockReset();
});

function renderIsland(onGenerate: (prompt: string) => void = vi.fn()) {
  return render(
    <MoodboardProvider>
      <FloatingIsland onGenerate={onGenerate} />
    </MoodboardProvider>,
  );
}

function imageFile(name: string): File {
  return new File(["fake-image-bytes"], name, { type: "image/png" });
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
    const onGenerate = vi.fn();
    renderIsland(onGenerate);
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    await user.type(input, "Retro travel poster");
    await user.click(screen.getByRole("button", { name: "Generate poster" }));
    expect(onGenerate).toHaveBeenCalledWith("Retro travel poster");
  });

  it("adds dropped images to the moodboard", () => {
    renderIsland();
    const island = screen.getByTestId("floating-island");
    fireEvent.dragOver(island);
    expect(island).toHaveClass("island-dragging");
    fireEvent.drop(island, {
      dataTransfer: { files: [imageFile("one.png"), imageFile("two.png")] },
    });
    const thumbs = screen.getAllByRole("img");
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0]).toHaveAttribute("alt", "one.png");
    expect(screen.getByTestId("moodboard")).toBeInTheDocument();
  });

  it("ignores non-image drops", () => {
    renderIsland();
    const island = screen.getByTestId("floating-island");
    fireEvent.drop(island, {
      dataTransfer: {
        files: [new File(["x"], "notes.txt", { type: "text/plain" })],
      },
    });
    expect(screen.queryByTestId("moodboard")).not.toBeInTheDocument();
  });

  it("removes a reference with its remove button", () => {
    renderIsland();
    const island = screen.getByTestId("floating-island");
    fireEvent.drop(island, {
      dataTransfer: { files: [imageFile("one.png")] },
    });
    const remove = screen.getByRole("button", { name: "Remove one.png" });
    fireEvent.click(remove);
    expect(screen.queryByTestId("moodboard")).not.toBeInTheDocument();
  });

  it("enables submit when a reference exists", () => {
    renderIsland();
    const island = screen.getByTestId("floating-island");
    fireEvent.drop(island, {
      dataTransfer: { files: [imageFile("one.png")] },
    });
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
      clipboardData: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] },
    });
    expect(screen.queryByTestId("moodboard")).not.toBeInTheDocument();
  });
});
