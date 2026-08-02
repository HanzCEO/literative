import {
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
  /** Abort the running agent. */
  onStop: () => void;
  /** Open the poster document in the full editor. */
  onEdit?: () => void;
  /** True when an agent document exists and can be edited. */
  canEdit?: boolean;
}

/**
 * The agent chat bubble: a viewport-fixed bubble on the left of the
 * screen that streams the agent's tool calls and results. The prompt
 * itself is typed only into the floating island input.
 */
export function AgentConsole({
  running,
  activity,
  onStop,
  onEdit,
  canEdit = false,
}: AgentConsoleProps) {
  return (
    <aside className="agent-console" aria-label="Design agent chat">
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
    </aside>
  );
}
