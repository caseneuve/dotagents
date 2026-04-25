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

function selectionFromMessageEntry(entry: AssistantMessageEntry): {
  selection?: AssistantResponseSelection;
  error?: string;
} {
  if (entry.message.role !== "assistant") {
    return { error: "Selected entry is not an assistant message" };
  }

  if (entry.message.stopReason && entry.message.stopReason !== "stop") {
    return {
      error: `Assistant message incomplete (${entry.message.stopReason})`,
    };
  }

  const text = collectAssistantText(entry.message);
  if (!text) {
    return { error: "Assistant message has no text content" };
  }

  return {
    selection: {
      messageEntryId: entry.id,
      text,
      timestamp: entry.message.timestamp,
    },
  };
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

    return selectionFromMessageEntry(messageEntry);
  }

  return { error: "No completed assistant response found on this branch" };
}

/**
 * Look up a specific assistant response by its session entry id. Used when the
 * user picks an assistant message via the tree picker, rather than taking the
 * latest on the current branch.
 *
 * Searches the provided entries array — caller typically passes
 * `sessionManager.getEntries()` so picks from abandoned branches still work.
 */
export function getAssistantResponseById(
  entries: SessionEntry[],
  entryId: string,
): { selection?: AssistantResponseSelection; error?: string } {
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return { error: "Entry not found in session" };
  if (entry.type !== "message") {
    return { error: "Selected entry is not a message" };
  }
  return selectionFromMessageEntry(entry as AssistantMessageEntry);
}
