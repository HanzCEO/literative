/** Frontend client for the design agent running in the Rust backend. */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { fileToBase64 } from "./file";
import type { PosterDocument } from "../state/posterDocument";
import type { ReferenceImage } from "../state/MoodboardContext";
import type {
  GenerationParams,
  GlobalSettings,
} from "../state/settingsTypes";

/** The reference-image payload the Rust backend expects. */
export interface ReferencePayload {
  name: string;
  mimeType: string;
  dataBase64: string;
}

/** One event streamed by the agent loop. */
export type AgentEvent =
  | { kind: "turn"; number: number }
  | { kind: "toolCall"; name: string; arguments: unknown }
  | { kind: "toolResult"; name: string; ok: boolean; detail: string }
  | { kind: "imageProgress"; phase: string }
  | { kind: "imageAdded"; width: number; height: number }
  | { kind: "document"; document: PosterDocument }
  | { kind: "stopped" }
  | { kind: "done"; summary: string }
  | { kind: "error"; message: string };

/** The request payload for agent_run. */
export interface AgentRequest {
  prompt: string;
  document: PosterDocument;
  settings: GlobalSettings;
  params: GenerationParams;
  references: ReferencePayload[];
  /** The turn number the loop starts from; a project continues its count. */
  startTurn: number;
}

/** The final outcome of an agent run. */
export interface AgentOutcome {
  document: PosterDocument;
  events: AgentEvent[];
}

/** Convert moodboard references into the backend payload. */
export async function referencePayloads(
  references: ReferenceImage[],
): Promise<ReferencePayload[]> {
  return Promise.all(
    references.map(async (reference) => ({
      name: reference.name,
      mimeType: reference.mimeType,
      dataBase64: await fileToBase64(reference.file),
    })),
  );
}

/** Start an agent run. Events stream over the agent-event channel. */
export function runAgent(request: AgentRequest): Promise<AgentOutcome> {
  return invoke<AgentOutcome>("agent_run", { request });
}

/** Ask the running agent to stop after its current tool call. */
export function stopAgent(): Promise<void> {
  return invoke<void>("agent_stop");
}

/** Subscribe to agent events. Resolves with an unlisten function. */
export function listenAgentEvents(
  handler: (event: AgentEvent) => void,
): Promise<UnlistenFn> {
  return listen<AgentEvent>("agent-event", (incoming) => {
    handler(incoming.payload);
  });
}

/** A readable summary of a tool call for the console. */
export function summarizeToolArguments(name: string, args: unknown): string {
  if (typeof args !== "object" || args === null) {
    return String(args ?? "");
  }
  const value = args as Record<string, unknown>;
  switch (name) {
    case "place_object":
      return [
        String(value.kind ?? ""),
        value.content ? `"${value.content}"` : undefined,
      ]
        .filter(Boolean)
        .join(" ");
    case "move_object":
      return `to (${value.x}, ${value.y})`;
    case "delete_object":
      return `id ${value.id}`;
    case "rotate_object":
      return `id ${value.id} by ${value.degrees} deg`;
    case "edit_object_property":
      return `${value.property} of ${value.id}`;
    case "generate_image":
      return typeof value.prompt === "string" ? value.prompt : "";
    default:
      return JSON.stringify(value);
  }
}

/**
 * The document point where a canvas-affecting tool works, for the
 * animated agent cursor. Tools without coordinates focus their target
 * layer, or the poster center as the last resort.
 */
export function cursorPositionForTool(
  name: string,
  args: unknown,
  document: PosterDocument | null,
): { x: number; y: number } | null {
  const value = (args ?? {}) as Record<string, unknown>;
  const width = document?.width ?? 1024;
  const height = document?.height ?? 1536;
  const center = { x: width / 2, y: height / 2 };
  if (name === "place_object" || name === "move_object") {
    const x = typeof value.x === "number" ? value.x : Number.NaN;
    const y = typeof value.y === "number" ? value.y : Number.NaN;
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return { x, y };
    }
    return center;
  }
  if (name === "generate_image") {
    return center;
  }
  if (
    name === "delete_object" ||
    name === "rotate_object" ||
    name === "edit_object_property"
  ) {
    const id = typeof value.id === "string" ? value.id : null;
    if (id && document) {
      const layer = document.layers.find((item) => item.id === id);
      if (layer) {
        return { x: layer.x, y: layer.y };
      }
    }
  }
  return center;
}
