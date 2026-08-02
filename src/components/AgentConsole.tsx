import { useState, type FormEvent } from "react";
import {
  ArrowUp,
  CircleNotch,
  PencilSimple,
  Robot,
  Stop,
} from "@phosphor-icons/react";

/** One rendered line of agent activity. */
export interface AgentActivityItem {
  id: number;
  kind:
    | "turn"
    | "tool"
    | "result"
    | "image"
    | "done"
    | "stopped"
    | "error";
  text: string;
  ok?: boolean;
}

interface AgentConsoleProps {
  /** True while an agent run is active. */
  running: boolean;
  /** The streamed activity lines. */
  activity: AgentActivityItem[];
  /** Start a run with the trimmed prompt. */
  onRun: (prompt: string) => void;
  /** Abort the running agent. */
  onStop: () => void;
  /** Open the poster document in the full editor. */
  onEdit?: () => void;
  /** True when an agent document exists and can be edited. */
  canEdit?: boolean;
  /** Disables the whole console, for example outside a project. */
  disabled?: boolean;
}

/**
 * The agent console: a prompt box for the design agent plus a live
 * stream of the tool calls and results it performs on the poster.
 */
export function AgentConsole({
  running,
  activity,
  onRun,
  onStop,
  onEdit,
  canEdit = false,
  disabled = false,
}: AgentConsoleProps) {
  const [prompt, setPrompt] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || running || disabled) {
      return;
    }
    onRun(trimmed);
    setPrompt("");
  }

  return (
    <aside className="agent-console" aria-label="Agent console">
      <div className="agent-console-header">
        <Robot size={15} weight="duotone" />
        <span>Design agent</span>
        {canEdit && !running && (
          <button
            type="button"
            className="agent-edit"
            aria-label="Open agent result in editor"
            onClick={onEdit}
          >
            <PencilSimple size={14} weight="bold" />
          </button>
        )}
        {running && (
          <button
            type="button"
            className="agent-stop"
            aria-label="Stop agent"
            onClick={onStop}
          >
            <Stop size={14} weight="bold" />
          </button>
        )}
      </div>
      <ul className="agent-activity" aria-label="Agent activity">
        {activity.length === 0 && (
          <li className="agent-activity-empty">
            Ask the agent to build a poster. It plans with a completion
            model and edits the poster with tools.
          </li>
        )}
        {activity.map((item) => (
          <li
            key={item.id}
            className={`agent-line agent-line-${item.kind}${
              item.ok === false ? " agent-line-fail" : ""
            }`}
          >
            {item.text}
          </li>
        ))}
      </ul>
      <form className="agent-form" onSubmit={handleSubmit}>
        <input
          className="agent-input"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={
            running ? "The agent is working..." : "Prompt the design agent"
          }
          aria-label="Agent prompt"
          disabled={running || disabled}
        />
        {running ? (
          <span className="agent-spinner" aria-hidden="true">
            <CircleNotch size={18} weight="bold" className="spin" />
          </span>
        ) : (
          <button
            type="submit"
            className="agent-submit"
            aria-label="Run agent"
            disabled={!prompt.trim() || disabled}
          >
            <ArrowUp size={18} weight="bold" />
          </button>
        )}
      </form>
    </aside>
  );
}
