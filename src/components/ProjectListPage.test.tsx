import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectsProvider } from "../state/ProjectsContext";
import { ProjectListPage } from "./ProjectListPage";

const STORAGE_KEY = "literative.projects";

function renderPage() {
  return render(
    <ProjectsProvider>
      <ProjectListPage onNewProject={vi.fn()} onOpenProject={vi.fn()} />
    </ProjectsProvider>,
  );
}

async function openMenu() {
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole("button", { name: "Options for Demo" }));
  await screen.findByRole("button", { name: "Delete" });
}

describe("project menu", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "p1",
          name: "Demo",
          description: "",
          createdAt: new Date().toISOString(),
          posterSize: { width: 1024, height: 1536 },
        },
      ]),
    );
  });

  it("closes when the backdrop is clicked", async () => {
    await openMenu();
    const backdrop = document.querySelector(".project-menu-backdrop");
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument(),
    );
  });

  it("closes on the Escape key", async () => {
    await openMenu();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument(),
    );
  });

  it("deletes the project and closes the menu", async () => {
    const user = userEvent.setup();
    await openMenu();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument(),
    );
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    expect(stored).toHaveLength(0);
  });

  it("orders the projects by last change, newest first", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "p-old",
          name: "Older",
          description: "",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          posterSize: { width: 1024, height: 1536 },
        },
        {
          id: "p-new",
          name: "Newer",
          description: "",
          createdAt: "2026-02-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
          posterSize: { width: 1024, height: 1536 },
        },
        // Legacy record without updatedAt: falls back to createdAt.
        {
          id: "p-legacy",
          name: "Legacy",
          description: "",
          createdAt: "2026-02-15T00:00:00.000Z",
          posterSize: { width: 1024, height: 1536 },
        },
      ]),
    );
    renderPage();
    const names = screen
      .getAllByRole("button")
      .filter((button) =>
        button.classList.contains("project-card-open"),
      )
      .map((button) =>
        button.querySelector(".project-card-name")?.textContent,
      );
    expect(names).toEqual(["Newer", "Legacy", "Older"]);
  });

  it("marks the active project with the card rail class", async () => {
    localStorage.setItem("literative.activeProject", "p1");
    renderPage();
    const active = document.querySelector(".project-card-active");
    expect(active).not.toBeNull();
    expect(active?.querySelector(".project-card-name")?.textContent).toBe(
      "Demo",
    );
  });
});
