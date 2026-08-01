import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewProjectPage } from "./NewProjectPage";

describe("NewProjectPage poster size", () => {
  it("shows the preset cards under the custom size fields", () => {
    render(<NewProjectPage onCancel={() => {}} onCreate={() => {}} />);
    expect(
      screen.getByRole("group", { name: "Poster size presets" }),
    ).toBeInTheDocument();
    for (const label of [
      "A4",
      "A5",
      "16:9 Screen",
      "Instagram portrait",
      "Instagram square",
      "Instagram landscape",
    ]) {
      expect(
        screen.getByRole("button", { name: new RegExp(label) }),
      ).toBeInTheDocument();
    }
    expect(
      screen.getByRole("textbox", { name: "Poster width in pixels" }),
    ).toHaveValue("1024");
    expect(
      screen.getByRole("textbox", { name: "Poster height in pixels" }),
    ).toHaveValue("1536");
  });

  it("fills the custom fields when a preset card is clicked", async () => {
    const user = userEvent.setup();
    render(<NewProjectPage onCancel={() => {}} onCreate={() => {}} />);
    await user.click(
      screen.getByRole("button", { name: /A4/ }),
    );
    expect(
      screen.getByRole("textbox", { name: "Poster width in pixels" }),
    ).toHaveValue("1240");
    expect(
      screen.getByRole("textbox", { name: "Poster height in pixels" }),
    ).toHaveValue("1754");
    expect(
      screen.getByRole("button", { name: /A4/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("creates the project with the chosen custom size", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<NewProjectPage onCancel={() => {}} onCreate={onCreate} />);
    await user.type(screen.getByRole("textbox", { name: "Project name" }), "Demo");
    const width = screen.getByRole("textbox", {
      name: "Poster width in pixels",
    });
    const height = screen.getByRole("textbox", {
      name: "Poster height in pixels",
    });
    await user.clear(width);
    await user.type(width, "800");
    await user.clear(height);
    await user.type(height, "600");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Demo",
        posterSize: { width: 800, height: 600 },
      }),
    );
  });

  it("shows the size error only after a submit attempt", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<NewProjectPage onCancel={() => {}} onCreate={onCreate} />);
    await user.type(screen.getByRole("textbox", { name: "Project name" }), "Demo");
    const width = screen.getByRole("textbox", {
      name: "Poster width in pixels",
    });
    await user.clear(width);
    await user.type(width, "0");
    // Typing must not raise the error or shift the layout.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create project" }),
    ).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Create project" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Width and height must be whole pixels",
    );
    expect(onCreate).not.toHaveBeenCalled();
  });
});
