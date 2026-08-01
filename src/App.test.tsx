import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

describe("App shell", () => {
  it("starts on the project list page", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "Projects" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "New project" }).length,
    ).toBeGreaterThan(0);
  });

  it("does not show the brand text", () => {
    render(<App />);
    expect(screen.queryByText("Literative")).not.toBeInTheDocument();
  });

  it("toggles between light and dark theme", async () => {
    const user = userEvent.setup();
    render(<App />);
    const toggle = screen.getByRole("button", { name: /switch to/i });
    expect(document.documentElement.dataset.theme).toBe("light");
    await user.click(toggle);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("literative.theme")).toBe("dark");
    await user.click(toggle);
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
