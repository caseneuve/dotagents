import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import {
  Container,
  type SelectItem,
  SelectList,
  Spacer,
  Text,
  truncateToWidth,
} from "@mariozechner/pi-tui";

type SessionMessageEntryLike = {
  id: string;
  parentId: string | null;
  type: "message";
  message: {
    role: string;
    content?: string | Array<{ type?: string; text?: string }>;
    timestamp?: number;
  };
};

type SessionEntryLike = {
  id: string;
  parentId: string | null;
  type: string;
  message?: SessionMessageEntryLike["message"];
};

type BookmarkCandidate = {
  id: string;
  prompt: string;
  label?: string;
};

const PROMPT_PREVIEW_WIDTH = 72;

function extractMessageText(
  content: SessionMessageEntryLike["message"]["content"],
): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        part?.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function normalizePromptPreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "(empty prompt)";
  }
  return truncateToWidth(normalized, PROMPT_PREVIEW_WIDTH);
}

function buildBranchEntries(ctx: ExtensionContext): SessionEntryLike[] {
  const entries: SessionEntryLike[] = [];
  let currentId = ctx.sessionManager.getLeafId();

  while (currentId) {
    const entry = ctx.sessionManager.getEntry(currentId) as
      | SessionEntryLike
      | undefined;
    if (!entry) break;
    entries.push(entry);
    currentId = entry.parentId;
  }

  return entries;
}

function collectBookmarkCandidates(ctx: ExtensionContext): BookmarkCandidate[] {
  const branchEntries = buildBranchEntries(ctx);
  const candidates: BookmarkCandidate[] = [];

  for (const entry of branchEntries) {
    if (entry.type !== "message" || entry.message?.role !== "user") {
      continue;
    }

    const prompt = extractMessageText(entry.message.content);
    candidates.push({
      id: entry.id,
      prompt,
      label: ctx.sessionManager.getLabel(entry.id),
    });
  }

  return candidates;
}

function buildDefaultLabel(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return `bookmark-${Date.now()}`;
  }
  return normalized.slice(0, 48).trim();
}

async function selectPromptForBookmark(
  ctx: ExtensionContext,
  candidates: BookmarkCandidate[],
): Promise<BookmarkCandidate | null> {
  if (!ctx.hasUI) {
    return null;
  }

  const items: SelectItem[] = candidates.map((candidate, index) => {
    const prefix = index === 0 ? "current" : `-${index}`;
    const existingLabel = candidate.label ? ` [${candidate.label}]` : "";
    return {
      value: candidate.id,
      label: `${prefix} ${normalizePromptPreview(candidate.prompt)}${existingLabel}`,
      description: "",
    };
  });

  const selectedId = await ctx.ui.custom<string | null>(
    (tui, theme, keybindings, done) => {
      const container = new Container();
      container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
      container.addChild(
        new Text(
          theme.fg(
            "accent",
            theme.bold("Bookmark a prompt on the current branch"),
          ),
          1,
          0,
        ),
      );
      container.addChild(
        new Text(
          theme.fg(
            "dim",
            "Choose a user prompt from the active branch only. Newest prompts are shown first.",
          ),
          1,
          0,
        ),
      );
      container.addChild(new Spacer(1));

      const selectList = new SelectList(items, Math.min(items.length, 12), {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      });

      selectList.onSelect = (item) => done(String(item.value));
      selectList.onCancel = () => done(null);

      container.addChild(selectList);
      container.addChild(new Spacer(1));
      container.addChild(
        new Text(theme.fg("dim", "Enter to bookmark • Esc to cancel"), 1, 0),
      );
      container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));

      return {
        render(width: number) {
          return container.render(width);
        },
        invalidate() {
          container.invalidate();
        },
        handleInput(data: string) {
          if (
            keybindings.matches(data, "tui.select.up") ||
            keybindings.matches(data, "tui.select.down") ||
            keybindings.matches(data, "tui.select.confirm") ||
            keybindings.matches(data, "tui.select.cancel")
          ) {
            selectList.handleInput(data);
            tui.requestRender();
          }
        },
      };
    },
  );

  if (!selectedId) {
    return null;
  }

  return candidates.find((candidate) => candidate.id === selectedId) ?? null;
}

export default function bookmarkExtension(pi: ExtensionAPI) {
  pi.registerCommand("bookmark", {
    description: "Pick a prompt from the current branch and attach a label",
    handler: async (args, ctx) => {
      const candidates = collectBookmarkCandidates(ctx);
      if (candidates.length === 0) {
        ctx.ui.notify("No user prompts found on the current branch", "warning");
        return;
      }

      if (!ctx.hasUI) {
        ctx.ui.notify("/bookmark requires interactive mode", "error");
        return;
      }

      const candidate = await selectPromptForBookmark(ctx, candidates);
      if (!candidate) {
        ctx.ui.notify("Bookmark cancelled", "info");
        return;
      }

      const providedLabel = args.trim();
      const initialValue =
        candidate.label ?? buildDefaultLabel(candidate.prompt);
      const label =
        providedLabel || (await ctx.ui.input("Bookmark label", initialValue));
      const normalizedLabel = label?.trim();

      if (!normalizedLabel) {
        ctx.ui.notify("Bookmark cancelled", "info");
        return;
      }

      pi.setLabel(candidate.id, normalizedLabel);
      pi.events.emit("bookmark:changed", {
        entryId: candidate.id,
        label: normalizedLabel,
      });
      ctx.ui.notify(`Bookmarked prompt as: ${normalizedLabel}`, "info");
    },
  });
}
