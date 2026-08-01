import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

function dropImage() {
  const island = screen.getByTestId("floating-island");
  const file = new File(["fake-image-bytes"], "mood.png", {
    type: "image/png",
  });
  fireEvent.drop(island, { dataTransfer: { files: [file] } });
}

describe("generation flow", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("displays the generated poster on the canvas", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockResolvedValue({
      dataUrl: "data:image/png;base64,Z2VuZXJhdGVk",
      width: 1024,
      height: 1024,
    });
    render(<App />);
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    await user.type(input, "A neon jazz poster");
    await user.click(screen.getByRole("button", { name: "Generate poster" }));

    const poster = await screen.findByAltText("Generated poster");
    expect(poster).toBeInTheDocument();
    expect(poster).toHaveAttribute(
      "src",
      "data:image/png;base64,Z2VuZXJhdGVk",
    );
    expect(screen.getByText("1024 x 1024 px")).toBeInTheDocument();
    expect(mockedInvoke).toHaveBeenCalledWith(
      "generate_poster",
      expect.objectContaining({ prompt: "A neon jazz poster" }),
    );
  });

  it("sends dropped references with the prompt", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation((command) => {
      if (command === "get_app_settings") {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        dataUrl: "data:image/png;base64,xxx",
        width: 1,
        height: 1,
      });
    });
    render(<App />);
    dropImage();
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    await user.type(input, "poster");
    await user.click(screen.getByRole("button", { name: "Generate poster" }));
    await screen.findByAltText("Generated poster");
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

  it("shows the error message when generation fails", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockRejectedValue(new Error("connection refused"));
    render(<App />);
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    await user.type(input, "poster");
    await user.click(screen.getByRole("button", { name: "Generate poster" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("connection refused"),
    );
    expect(screen.queryByAltText("Generated poster")).not.toBeInTheDocument();
  });

  it("dismisses the poster with its close button", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockResolvedValue({
      dataUrl: "data:image/png;base64,xxx",
      width: 512,
      height: 512,
    });
    render(<App />);
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    await user.type(input, "poster");
    await user.click(screen.getByRole("button", { name: "Generate poster" }));
    await screen.findByAltText("Generated poster");
    await user.click(screen.getByRole("button", { name: "Dismiss poster" }));
    await waitFor(() =>
      expect(screen.queryByAltText("Generated poster")).not.toBeInTheDocument(),
    );
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
    render(<App />);
    const input = screen.getByRole("textbox", { name: "Poster prompt" });
    await user.type(input, "poster");
    await user.click(screen.getByRole("button", { name: "Generate poster" }));
    expect(input).toBeDisabled();
    resolveInvoke({ dataUrl: "data:image/png;base64,x", width: 1, height: 1 });
    await screen.findByAltText("Generated poster");
  });
});
