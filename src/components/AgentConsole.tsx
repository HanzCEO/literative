import { useEffect, useRef, useState } from "react";
import { PencilSimple, Trash } from "@phosphor-icons/react";
import type { AgentChatMessage } from "../lib/agentChat";

export type { AgentChatMessage, AgentTurnItem } from "../lib/agentChat";

interface AgentConsoleProps {
  /** True while an agent run is active. */
  running: boolean;
  /** The chat bubbles, user prompts and agent turns. */
  chat: AgentChatMessage[];
  /** Open the poster document in the full editor. */
  onEdit?: () => void;
  /** Clear the session chat; the poster document stays. */
  onClearChat: () => void;
  /** True when an agent document exists and can be edited. */
  canEdit?: boolean;
}

/**
 * The agent chat: a viewport-fixed column on the left. The user prompt
 * is its own bubble on the right, and each agent turn streams into its
 * own separated bubble on the left. The prompt itself is typed only
 * into the floating island input. The column has no panel chrome: the
 * bubbles float directly over the canvas, and the open-in-editor and
 * clear-chat actions hover above the newest bubble. Stopping a run
 * happens from the island submit button.
 */
export function AgentConsole({
  running,
  chat,
  onEdit,
  onClearChat,
  canEdit = false,
}: AgentConsoleProps) {
  const listRef = useRef<HTMLUListElement>(null);
  // True while the user is scrolled near the bottom; only then does a
  // new bubble pull the list down to the newest line.
  const stickToBottomRef = useRef(true);
  // Edge fades: true when the list cuts off bubbles on that side, so
  // the chat reads as continuous above and below the viewport.
  const [fadeTop, setFadeTop] = useState(false);
  const [fadeBottom, setFadeBottom] = useState(false);

  function updateFades() {
    const list = listRef.current;
    if (!list) return;
    const distanceFromBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight;
    setFadeTop(list.scrollTop > 4);
    // The bottom fade appears only once the user has scrolled up;
    // pinned at the bottom there is nothing hidden below.
    setFadeBottom(distanceFromBottom > 4);
  }

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (stickToBottomRef.current) {
      list.scrollTop = list.scrollHeight;
    }
    updateFades();
  }, [chat]);

  function handleScroll() {
    const list = listRef.current;
    if (!list) return;
    const distanceFromBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 48;
    updateFades();
  }

  const showEdit = canEdit && !running;
  return (
    <aside className="agent-console" aria-label="Design agent chat">
      {(showEdit || chat.length > 0) && (
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
          <button
            type="button"
            className="agent-clear"
            aria-label="Clear session chat"
            title="Clear session chat"
            onClick={onClearChat}
          >
            <Trash size={14} weight="bold" />
          </button>
        </div>
      )}
      <div className="agent-activity-wrap">
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
        {fadeTop && <div className="agent-console-fade agent-console-fade-top" />}
        {fadeBottom && (
          <div className="agent-console-fade agent-console-fade-bottom" />
        )}
      </div>
    </aside>
  );
}
