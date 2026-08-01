import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { defaultGlobalSettings } from "./state/settingsTypes";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

async function openSettings() {
  render(<App />);
  await userEvent.click(screen.getByRole("button", { name: "Open settings" }));
  await screen.findByRole("dialog", { name: "Settings" });
}

describe("settings surface", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue(null); // no persisted settings on first run
  });

  it("shows defaults in the dialog on first run", async () => {
    await openSettings();
    expect(screen.getByLabelText("Generation preset")).toHaveValue(
      "krea_2_turbo",
    );
    expect(screen.getByLabelText("Endpoint type")).toHaveValue(
      "stable_diffusion",
    );
    expect(screen.getByLabelText("Endpoint URL")).toHaveValue(
      "http://127.0.0.1:7860",
    );
    expect(screen.getByLabelText("Width")).toHaveValue(1024);
    expect(screen.getByLabelText("Steps")).toHaveValue(8);
  });

  it("fills parameters when the preset changes", async () => {
    const user = userEvent.setup();
    await openSettings();
    await user.selectOptions(
      screen.getByLabelText("Generation preset"),
      "qwen_image_flash",
    );
    expect(screen.getByLabelText("Steps")).toHaveValue(20);
    expect(screen.getByLabelText("Height")).toHaveValue(1536);
  });

  it("saves edited settings through the backend", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockResolvedValue(defaultGlobalSettings());
    await openSettings();
    const endpoint = screen.getByLabelText("Endpoint URL");
    await user.clear(endpoint);
    await user.type(endpoint, "http://127.0.0.1:7860");
    await user.selectOptions(
      screen.getByLabelText("Generation preset"),
      "qwen_image_flash",
    );
    await user.selectOptions(
      screen.getByLabelText("Endpoint type"),
      "open_ai_compatible",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    const saveCall = mockedInvoke.mock.calls.find(
      (call) => call[0] === "save_app_settings",
    );
    expect(saveCall).toBeDefined();
    const args = saveCall![1] as {
      settings: {
        preset: string;
        endpointType: string;
        endpoint: string;
        params: { steps: number };
      };
    };
    expect(args.settings.preset).toBe("qwen_image_flash");
    expect(args.settings.endpointType).toBe("open_ai_compatible");
    expect(args.settings.endpoint).toBe("http://127.0.0.1:7860");
    expect(args.settings.params.steps).toBe(20);
  });

  it("loads persisted settings into the dialog", async () => {
    mockedInvoke.mockResolvedValue({
      ...defaultGlobalSettings(),
      preset: "qwen_image_flash",
      endpointType: "open_ai_compatible",
      endpoint: "http://127.0.0.1:7860",
      theme: "dark",
      params: { ...defaultGlobalSettings().params, steps: 25 },
    });
    await openSettings();
    await waitFor(() =>
      expect(screen.getByLabelText("Generation preset")).toHaveValue(
        "qwen_image_flash",
      ),
    );
    expect(screen.getByLabelText("Endpoint type")).toHaveValue(
      "open_ai_compatible",
    );
    expect(screen.getByLabelText("Endpoint URL")).toHaveValue(
      "http://127.0.0.1:7860",
    );
    expect(screen.getByLabelText("Steps")).toHaveValue(25);
  });

  it("applies the persisted dark theme from settings", async () => {
    mockedInvoke.mockResolvedValue({
      ...defaultGlobalSettings(),
      theme: "dark",
    });
    render(<App />);
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("dark"),
    );
  });

  it("persists the theme when the header toggle is used", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: "Switch to dark mode" }),
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
    await waitFor(() => {
      const saveCall = mockedInvoke.mock.calls.find(
        (call) => call[0] === "save_app_settings",
      );
      expect(saveCall).toBeDefined();
      const args = saveCall![1] as { settings: { theme: string } };
      expect(args.settings.theme).toBe("dark");
    });
  });

  it("cancels without saving", async () => {
    const user = userEvent.setup();
    await openSettings();
    const endpoint = screen.getByLabelText("Endpoint URL");
    await user.clear(endpoint);
    await user.type(endpoint, "http://changed.example");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      mockedInvoke.mock.calls.find((call) => call[0] === "save_app_settings"),
    ).toBeUndefined();
  });

  it("clamps parameter values on save", async () => {
    const user = userEvent.setup();
    await openSettings();
    const width = screen.getByLabelText("Width");
    await user.clear(width);
    await user.type(width, "99999");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    const saveCall = mockedInvoke.mock.calls.find(
      (call) => call[0] === "save_app_settings",
    );
    const args = saveCall![1] as { settings: { params: { width: number } } };
    expect(args.settings.params.width).toBe(4096);
  });

  it("handles a settings load failure gracefully", async () => {
    mockedInvoke.mockRejectedValue(new Error("no config dir"));
    render(<App />);
    // The app still renders with defaults on the project list.
    expect(
      screen.getAllByRole("button", { name: "New project" }).length,
    ).toBeGreaterThan(0);
  });
});
