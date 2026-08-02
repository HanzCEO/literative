import {
  PencilSimple,
  Stop,
} from "@phosphor-icons/react";
import type { AgentChatMessage } from "../lib/agentChat";

export type { AgentChatMessage, AgentTurnItem } from "../lib/agentChat";

interface AgentConsoleProps {
  /** True while an agent run is active. */
  running: boolean;
  /** The chat bubbles, user prompts and agent turns. */
  chat: AgentChatMessage[];
  /** Abort the running agent. */
  onStop: () => void;
  /** Open the poster document in the full editor. */
  onEdit?: () => void;
  /** True when an agent document exists and can be edited. */
  canEdit?: boolean;
}

/**
 * The agent chat: a viewport-fixed column on the left. The user prompt
 * is its own bubble on the right, and each agent turn streams into its
 * own separated bubble on the left. The prompt itself is typed only
 * into the floating island input. The column has no panel chrome: the
 * bubbles float directly over the canvas, and the stop and edit
 * controls hover above the newest bubble.
 */
export function AgentConsole({
  running,
  chat,
  onStop,
  onEdit,
  canEdit = false,
}: AgentConsoleProps) {
  const showEdit = canEdit && !running;
  const showStop = running;
  return (
    <aside className="agent-console" aria-label="Design agent chat">
      {(showEdit || showStop) && (
        <div className="agent-console-actions">
          {showEdit && (
            <button
              type="button"
              className="agent-edit"
              aria-label="Open agent result in editor"
              title="Open in editor"
              onClick={onEdit}
            >
              <PencilSimple size={14} weight="bold" />
            </button>
          )}
          {showStop && (
            <button
              type="button"
              className="agent-stop"
              aria-label="Stop agent"
              title="Stop agent"
              onClick={onStop}
            >
              <Stop size={14} weight="bold" />
            </button>
          )}
        </div>
      )}
      <ul className="agent-activity" aria-label="Agent activity">
        {chat.map((message) =>
          message.kind === "user" ? (
            <li key={message.id} className="agent-bubble agent-bubble-user">
              {message.prompt}
            </li>
          ) : (
            <li key={message.id} className="agent-bubble agent-bubble-turn">
              <span className="agent-bubble-header">
                Turn {message.number}
              </span>
              {(message.items ?? []).map((item) => (
                <span
                  key={item.id}
                  className={`agent-line agent-line-${item.kind}${
                    item.ok === false ? " agent-line-fail" : ""
                  }`}
                >
                  {item.text}
                </span>
              ))}
            </li>
          ),
        )}
      </ul>
    </aside>
  );
}
