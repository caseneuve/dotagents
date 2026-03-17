import { Key } from "@mariozechner/pi-tui";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@mariozechner/pi-coding-agent";

type MessageEntry = SessionEntry & {
  type: "message";
  message: {
    role?: string;
    stopReason?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
};

function getLastAssistantTextBlock(branch: SessionEntry[]): {
  text?: string;
  error?: string;
} {
  for (let i = branch.length - 1; i >= 0; i -= 1) {
    const entry = branch[i] as SessionEntry;
    if (entry.type !== "message") continue;

    const message = (entry as MessageEntry).message;
    if (message.role !== "assistant") continue;

    if (message.stopReason && message.stopReason !== "stop") {
      return {
        error: `Last assistant message incomplete (${message.stopReason})`,
      };
    }

    const content = Array.isArray(message.content) ? message.content : [];
    for (let j = content.length - 1; j >= 0; j -= 1) {
      const block = content[j];
      if (block?.type !== "text") continue;
      const text = block.text?.trim();
      if (text) return { text };
    }

    return { error: "Last assistant message has no text block" };
  }

  return { error: "No assistant messages found" };
}

async function loadLastAssistantBlock(ctx: ExtensionContext) {
  if (!ctx.hasUI) {
    ctx.ui.notify("This action requires interactive mode", "error");
    return;
  }

  const { text, error } = getLastAssistantTextBlock(
    ctx.sessionManager.getBranch(),
  );
  if (!text) {
    ctx.ui.notify(error ?? "No assistant text block found", "warning");
    return;
  }

  ctx.ui.setEditorText(text);
  ctx.ui.notify(
    "Loaded last assistant text block into the editor. Press Ctrl+G to open it externally.",
    "info",
  );
}

export default function lastAssistantBlockExtension(pi: ExtensionAPI) {
  pi.registerCommand("last-assistant-block", {
    description: "Load the last assistant text block into the input editor",
    handler: async (_args, ctx) => {
      await loadLastAssistantBlock(ctx);
    },
  });

  pi.registerShortcut(Key.ctrl("x"), {
    description: "Load the last assistant text block into the input editor",
    handler: async (ctx) => {
      await loadLastAssistantBlock(ctx);
    },
  });
}
