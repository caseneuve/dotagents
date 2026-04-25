import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { TreeSelectorComponent } from "@mariozechner/pi-coding-agent";

type MessageEntryLike = {
  type: "message";
  id: string;
  message?: {
    role?: string;
    stopReason?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
};

function isAssistantMessageEntry(entry: unknown): entry is MessageEntryLike {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as MessageEntryLike;
  if (e.type !== "message") return false;
  return e.message?.role === "assistant";
}

function hasTextContent(entry: MessageEntryLike): boolean {
  const content = entry.message?.content;
  if (!Array.isArray(content)) return false;
  return content.some(
    (b) =>
      b?.type === "text" && typeof b.text === "string" && b.text.trim() !== "",
  );
}

/**
 * Open pi's `TreeSelectorComponent` inside an overlay and let the user pick
 * any assistant message in the session tree. Returns the selected entry id
 * (assistant message, has text, completed) or `undefined` on cancel.
 *
 * Validates the selection: non-assistant entries keep the selector open with
 * a toast telling the user to pick an assistant message. This avoids the
 * footgun where pressing Enter on a user message would close the picker
 * silently with an unusable selection.
 */
export async function pickAssistantMessage(
  ctx: ExtensionCommandContext,
): Promise<string | undefined> {
  return ctx.ui.custom<string | undefined>(
    (tui, _theme, _keybindings, done) => {
      const tree = ctx.sessionManager.getTree();
      const leafId = ctx.sessionManager.getLeafId();
      const termHeight = process.stdout.rows ?? 24;

      const component = new TreeSelectorComponent(
        tree,
        leafId,
        termHeight,
        (entryId: string) => {
          const entry = ctx.sessionManager.getEntry(entryId);
          if (!isAssistantMessageEntry(entry)) {
            ctx.ui.notify(
              "Pick an assistant message (not user / tool / compaction)",
              "warning",
            );
            tui.requestRender(true);
            return;
          }
          if (
            entry.message?.stopReason &&
            entry.message.stopReason !== "stop"
          ) {
            ctx.ui.notify(
              `That assistant message is incomplete (${entry.message.stopReason})`,
              "warning",
            );
            tui.requestRender(true);
            return;
          }
          if (!hasTextContent(entry)) {
            ctx.ui.notify(
              "That assistant message has no text content to outline",
              "warning",
            );
            tui.requestRender(true);
            return;
          }
          done(entryId);
        },
        () => done(undefined),
      );

      return component;
    },
    { overlay: true },
  );
}
