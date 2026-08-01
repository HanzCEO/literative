import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MoodboardProvider } from "../state/MoodboardContext";
import { FloatingIsland } from "./FloatingIsland";

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
});
