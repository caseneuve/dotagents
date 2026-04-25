import type {
  ExtensionCommandContext,
  SessionEntry,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { TreeSelectorComponent } from "@mariozechner/pi-coding-agent";

type SessionTreeNode = ReturnType<SessionManager["getTree"]>[number];

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

function isPickableAssistant(entry: SessionEntry): boolean {
  if (!isAssistantMessageEntry(entry)) return false;
  if (entry.message?.stopReason && entry.message.stopReason !== "stop") {
    return false;
  }
  return hasTextContent(entry);
}

/**
 * Trim a session tree to only pickable assistant messages, re-parenting any
 * surviving descendants past filtered-out nodes so branching is preserved.
 *
 * Given `user → assistantA → [user → assistantB, user → assistantC]`,
 * returns `assistantA → [assistantB, assistantC]` — the intermediate user
 * messages collapse. The resulting forest is still a valid SessionTreeNode[]
 * which TreeSelectorComponent consumes without modification.
 */
function filterTreeToAssistants(
  nodes: readonly SessionTreeNode[],
): SessionTreeNode[] {
  const result: SessionTreeNode[] = [];
  for (const node of nodes) {
    const filteredChildren = filterTreeToAssistants(node.children);
    if (isPickableAssistant(node.entry)) {
      result.push({
        entry: node.entry,
        children: filteredChildren,
        label: node.label,
        labelTimestamp: node.labelTimestamp,
      });
    } else {
      // Lift surviving descendants up past this non-assistant node so the
      // branching structure at assistant boundaries is preserved.
      result.push(...filteredChildren);
    }
  }
  return result;
}

/** Walk the current branch back-to-front and return the latest pickable
 *  assistant message id, or `null` if none. Used as the picker's initial
 *  selection so it opens on the most-recent-assistant from the user's POV. */
function findLatestAssistantIdOnBranch(
  branch: readonly SessionEntry[],
): string | null {
  for (let i = branch.length - 1; i >= 0; i--) {
    if (isPickableAssistant(branch[i])) return branch[i].id;
  }
  return null;
}

/**
 * Open pi's `TreeSelectorComponent` inside an overlay and let the user pick
 * any assistant message in the session tree. Returns the selected entry id
 * (assistant message, has text, completed) or `undefined` on cancel.
 *
 * The tree is pre-filtered to only pickable assistant messages; user /
 * tool / compaction / incomplete-assistant / empty-text nodes are hidden.
 * The initial selection is the latest assistant on the active branch so
 * pressing Enter immediately behaves like the `latest` default.
 */
export async function pickAssistantMessage(
  ctx: ExtensionCommandContext,
): Promise<string | undefined> {
  const fullTree = ctx.sessionManager.getTree();
  const filteredTree = filterTreeToAssistants(fullTree);

  if (filteredTree.length === 0) {
    ctx.ui.notify(
      "No completed assistant responses found in this session",
      "warning",
    );
    return undefined;
  }

  const branch = ctx.sessionManager.getBranch();
  const initialSelectedId = findLatestAssistantIdOnBranch(branch) ?? undefined;

  return ctx.ui.custom<string | undefined>(
    (tui, _theme, _keybindings, done) => {
      const termHeight = process.stdout.rows ?? 24;

      const component = new TreeSelectorComponent(
        filteredTree,
        // No 'current leaf' from the picker's POV — we never mutate the
        // session leaf. Passing null suppresses the active-path marker and
        // avoids misleading the user about which assistant is "live".
        null,
        termHeight,
        (entryId: string) => {
          const entry = ctx.sessionManager.getEntry(entryId);
          if (!entry || !isPickableAssistant(entry)) {
            // After pre-filtering this path should be unreachable, but keep
            // the defensive check so a future tree-mode tweak can't fall
            // through to a broken overlay state.
            ctx.ui.notify(
              "That entry isn't a pickable assistant message",
              "warning",
            );
            tui.requestRender(true);
            return;
          }
          done(entryId);
        },
        () => done(undefined),
        undefined,
        // Start the cursor on the latest assistant on the active branch so
        // Enter immediately reproduces the `/assistant-outline latest` flow.
        initialSelectedId,
      );

      return component;
    },
    { overlay: true },
  );
}
