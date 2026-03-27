import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import type { AssistantResponseSelection } from "./types";

type AssistantMessageEntry = SessionEntry & {
  type: "message";
  message: {
    role?: string;
    stopReason?: string;
    timestamp?: number;
    content?: Array<{ type?: string; text?: string }>;
  };
};

function collectAssistantText(
  message: AssistantMessageEntry["message"],
): string {
  const parts = Array.isArray(message.content)
    ? message.content
        .filter(
          (block) => block?.type === "text" && typeof block.text === "string",
        )
        .map((block) => block.text?.trim() ?? "")
        .filter(Boolean)
    : [];

  return parts.join("\n\n").trim();
}

export function getLatestAssistantResponse(branch: SessionEntry[]): {
  selection?: AssistantResponseSelection;
  error?: string;
} {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index] as SessionEntry;
    if (entry.type !== "message") continue;

    const messageEntry = entry as AssistantMessageEntry;
    if (messageEntry.message.role !== "assistant") continue;

    if (
      messageEntry.message.stopReason &&
      messageEntry.message.stopReason !== "stop"
    ) {
      return {
        error: `Last assistant message incomplete (${messageEntry.message.stopReason})`,
      };
    }

    const text = collectAssistantText(messageEntry.message);
    if (!text) {
      return { error: "Last assistant message has no text content" };
    }

    return {
      selection: {
        messageEntryId: messageEntry.id,
        text,
        timestamp: messageEntry.message.timestamp,
      },
    };
  }

  return { error: "No completed assistant response found on this branch" };
}
