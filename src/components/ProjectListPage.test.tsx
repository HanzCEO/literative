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
});
