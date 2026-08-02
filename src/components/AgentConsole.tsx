import { useEffect, useRef } from "react";
import { PencilSimple } from "@phosphor-icons/react";
import type { AgentChatMessage } from "../lib/agentChat";

export type { AgentChatMessage, AgentTurnItem } from "../lib/agentChat";

interface AgentConsoleProps {
  /** True while an agent run is active. */
  running: boolean;
  /** The chat bubbles, user prompts and agent turns. */
  chat: AgentChatMessage[];
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
 * bubbles float directly over the canvas, and the open-in-editor
 * action hovers above the newest bubble. Stopping a run happens from
 * the island submit button.
 */
export function AgentConsole({
  running,
  chat,
  onEdit,
  canEdit = false,
}: AgentConsoleProps) {
  const listRef = useRef<HTMLUListElement>(null);
  // True while the user is scrolled near the bottom; only then does a
  // new bubble pull the list down to the newest line.
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !stickToBottomRef.current) return;
    list.scrollTop = list.scrollHeight;
  }, [chat]);

  function handleScroll() {
    const list = listRef.current;
    if (!list) return;
    const distanceFromBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 48;
  }

  const showEdit = canEdit && !running;
  return (
    <aside className="agent-console" aria-label="Design agent chat">
      {showEdit && (
        <div className="agent-console-actions">
          <button
            type="button"
            className="agent-edit"
            aria-label="Open agent result in editor"
            title="Open in editor"
            onClick={onEdit}
          >
            <PencilSimple size={14} weight="bold" />
          </button>
        </div>
      )}
      <ul
        ref={listRef}
        className="agent-activity"
        aria-label="Agent activity"
        onScroll={handleScroll}
      >
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
              {(message.items ?? []).length === 0 ? (
                <span className="agent-line agent-line-thinking">
                  Thinking...
                </span>
              ) : (
                (message.items ?? []).map((item) => (
                  <span
                    key={item.id}
                    className={`agent-line agent-line-${item.kind}${
                      item.ok === false ? " agent-line-fail" : ""
                    }`}
                  >
                    {item.text}
                  </span>
                ))
              )}
            </li>
          ),
        )}
      </ul>
    </aside>
  );
}
