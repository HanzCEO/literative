import {
  PencilSimple,
  Robot,
  Stop,
} from "@phosphor-icons/react";

/** One streamed line inside an agent turn bubble. */
export interface AgentTurnItem {
  id: number;
  kind: "tool" | "result" | "image" | "done" | "stopped" | "error";
  text: string;
  ok?: boolean;
}

/** One message bubble in the agent chat. */
export interface AgentChatMessage {
  id: number;
  kind: "user" | "agent";
  /** The user's prompt, for user messages. */
  prompt?: string;
  /** The turn number, for agent messages. */
  number?: number;
  /** The streamed lines inside an agent turn bubble. */
  items?: AgentTurnItem[];
}

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
 * The agent chat: a viewport-fixed panel on the left. The user prompt
 * is its own bubble on the right, and each agent turn streams into its
 * own separated bubble on the left. The prompt itself is typed only
 * into the floating island input.
 */
export function AgentConsole({
  running,
  chat,
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
