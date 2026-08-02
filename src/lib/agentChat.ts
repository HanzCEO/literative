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
