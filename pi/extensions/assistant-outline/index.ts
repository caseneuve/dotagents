import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import {
  ASSISTANT_OUTLINE_COMMENTS_TYPE,
  buildCommentState,
  getStoredCommentsForMessage,
} from "./comments";
import { extractCommandSnippets, type CommandSnippet } from "./command-extract";
import {
  formatAllCommandsForEditor,
  formatCommandSnippetForEditor,
} from "./command-export";
import { formatCommandSnippetForPiEditor } from "./command-editor-export";
import { editSectionComment } from "./external-editor";
import {
  getNodeMarkdown,
  getNodePath,
  parseAssistantOutline,
} from "./markdown-outline";
import {
  AssistantOutlineOverlay,
  MIN_TERMINAL_COLUMNS,
  OVERLAY_OPTIONS,
} from "./overlay";
import { pickAssistantMessage } from "./picker";
import {
  getAssistantResponseById,
  getLatestAssistantResponse,
} from "./session";
import type {
  AssistantResponseSelection,
  ParsedAssistantOutline,
  SectionComments,
} from "./types";

const COMMAND_NAME = "assistant-outline";

// Argument options — surfaced via getArgumentCompletions for tab-complete.
const ARG_OPTIONS: AutocompleteItem[] = [
  {
    value: "latest",
    label: "latest",
    description:
      "open the outline for the latest assistant message on the current branch (default)",
  },
  {
    value: "pick",
    label: "pick",
    description:
      "open a tree picker to select any assistant message from the session history",
  },
];

type Mode = { kind: "latest" } | { kind: "pick" };

function parseMode(args: string): { mode: Mode } | { error: string } {
  const trimmed = args.trim().toLowerCase();
  if (trimmed === "" || trimmed === "latest")
    return { mode: { kind: "latest" } };
  if (trimmed === "pick" || trimmed === "tree")
    return { mode: { kind: "pick" } };
  return {
    error: `Unknown argument: "${args.trim()}". Try "latest" or "pick".`,
  };
}

export default function assistantOutlineExtension(pi: ExtensionAPI) {
  pi.registerCommand(COMMAND_NAME, {
    description:
      'Browse an assistant response as a markdown outline with section preview/comments. Pass "pick" to choose any message from the session tree.',
    getArgumentCompletions: (prefix) => {
      const lowered = prefix.toLowerCase();
      const filtered = ARG_OPTIONS.filter((opt) =>
        opt.value.startsWith(lowered),
      );
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify(`/${COMMAND_NAME} requires interactive mode`, "error");
        return;
      }

      const termWidth = process.stdout.columns ?? 0;
      if (termWidth < MIN_TERMINAL_COLUMNS) {
        ctx.ui.notify(
          `/${COMMAND_NAME} requires at least ${MIN_TERMINAL_COLUMNS} columns (current: ${termWidth})`,
          "warning",
        );
        return;
      }

      const parsed = parseMode(args);
      if ("error" in parsed) {
        ctx.ui.notify(parsed.error, "warning");
        return;
      }

      // Resolve which assistant response to open. `pinnedEntryId` is set when
      // the user picked a specific message via the tree selector — reload
      // re-fetches that id instead of the latest on the active branch.
      let selection: AssistantResponseSelection | undefined;
      let pinnedEntryId: string | undefined;
      let notFoundMessage: string | undefined;

      if (parsed.mode.kind === "pick") {
        const pickedId = await pickAssistantMessage(ctx);
        if (!pickedId) return; // user cancelled
        pinnedEntryId = pickedId;
        const picked = getAssistantResponseById(
          ctx.sessionManager.getEntries(),
          pickedId,
        );
        selection = picked.selection;
        notFoundMessage = picked.error;
      } else {
        const latest = getLatestAssistantResponse(
          ctx.sessionManager.getBranch(),
        );
        selection = latest.selection;
        notFoundMessage = latest.error;
      }

      if (!selection) {
        ctx.ui.notify(
          notFoundMessage ?? "No assistant response found",
          "warning",
        );
        return;
      }

      const branch = ctx.sessionManager.getBranch();
      let currentDocument: ParsedAssistantOutline | undefined =
        parseAssistantOutline(selection.text, selection.messageEntryId);
      let currentTimestamp = selection.timestamp;
      let comments: SectionComments = getStoredCommentsForMessage(
        branch,
        selection.messageEntryId,
      );
      let commandSnippets: CommandSnippet[] =
        extractCommandSnippets(currentDocument);

      const exportedSections = await ctx.ui.custom(
        (tui, theme, _kb, done) => {
          const reloadDocument = async () => {
            // When pinned to a specific entry (picker path), re-fetch THAT
            // entry by id. Otherwise fall back to the latest-on-branch flow.
            const next = pinnedEntryId
              ? getAssistantResponseById(
                  ctx.sessionManager.getEntries(),
                  pinnedEntryId,
                )
              : getLatestAssistantResponse(ctx.sessionManager.getBranch());
            if (!next.selection) {
              return {
                error: next.error ?? "No assistant response found",
              };
            }

            currentDocument = parseAssistantOutline(
              next.selection.text,
              next.selection.messageEntryId,
            );
            currentTimestamp = next.selection.timestamp;
            comments = getStoredCommentsForMessage(
              ctx.sessionManager.getBranch(),
              next.selection.messageEntryId,
            );
            commandSnippets = extractCommandSnippets(currentDocument);

            return { document: currentDocument, timestamp: currentTimestamp };
          };

          const openInEditor = async (
            buffer: string,
            missingMessage: string,
          ) => {
            const editorCommand = process.env.VISUAL || process.env.EDITOR;
            if (!editorCommand) {
              ctx.ui.notify(missingMessage, "warning");
              tui.requestRender(true);
              return;
            }

            const [editor, ...editorArgs] = editorCommand.split(" ");
            const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
            const os = await import("node:os");
            const path = await import("node:path");
            const { spawnSync } = await import("node:child_process");
            const tempDir = await mkdtemp(
              path.join(os.tmpdir(), "assistant-outline-commands-"),
            );
            const tempPath = path.join(tempDir, "commands.sh");
            await writeFile(tempPath, buffer, "utf8");

            tui.stop();
            try {
              const result = spawnSync(editor, [...editorArgs, tempPath], {
                stdio: "inherit",
                shell: process.platform === "win32",
              });
              if (result.status && result.status !== 0) {
                ctx.ui.notify(
                  `Editor exited with code ${result.status}`,
                  "warning",
                );
              }
            } finally {
              tui.start();
              tui.requestRender(true);
              await rm(tempDir, { recursive: true, force: true });
            }
          };

          const copyCommandToClipboard = async (snippet: CommandSnippet) => {
            const text = `${snippet.commandText.trim()}\n`;
            const candidates: Array<{ cmd: string; args: string[] }> = [
              { cmd: "wl-copy", args: [] },
              { cmd: "xclip", args: ["-selection", "clipboard"] },
              { cmd: "pbcopy", args: [] },
            ];

            const { spawnSync } = await import("node:child_process");
            for (const candidate of candidates) {
              const result = spawnSync(candidate.cmd, candidate.args, {
                input: text,
                encoding: "utf8",
                stdio: ["pipe", "ignore", "ignore"],
              });
              if (!result.error && result.status === 0) {
                ctx.ui.notify(
                  "Copied selected command snippet to the clipboard",
                  "info",
                );
                tui.requestRender(true);
                return;
              }
            }

            ctx.ui.notify(
              "Clipboard copy failed. Install wl-copy, xclip, or pbcopy.",
              "warning",
            );
            tui.requestRender(true);
          };

          const component = new AssistantOutlineOverlay(theme, {
            requestRender: (full) => tui.requestRender(Boolean(full)),
            onClose: (payload) => done(payload),
            onReload: async () => {
              const result = await reloadDocument();
              if (result.document) {
                component.setLoadedDocument(result.document, result.timestamp);
              }
              return result;
            },
            getComments: () => comments,
            getCommandSnippets: () => commandSnippets,
            onOpenCommandSnippet: async (snippet) => {
              await openInEditor(
                formatCommandSnippetForEditor(snippet, comments),
                "Set $VISUAL or $EDITOR to open assistant-outline command snippets",
              );
            },
            onOpenAllCommands: async () => {
              await openInEditor(
                formatAllCommandsForEditor(commandSnippets, comments),
                "Set $VISUAL or $EDITOR to open assistant-outline commands",
              );
            },
            onCopyCommandSnippet: async (snippet) => {
              await copyCommandToClipboard(snippet);
            },
            onEditComment: async (node) => {
              if (!currentDocument) return;

              const title = getNodePath(currentDocument, node.id).join(" > ");
              const editResult = await (async () => {
                tui.stop();
                try {
                  return await editSectionComment({
                    title,
                    markdown: getNodeMarkdown(currentDocument, node),
                    existingComment: comments[node.id] ?? "",
                  });
                } finally {
                  tui.start();
                }
              })();

              if (!editResult.ok) {
                ctx.ui.notify(
                  editResult.message,
                  editResult.reason === "missing-editor" ? "warning" : "error",
                );
                tui.requestRender(true);
                return;
              }

              const nextComment = editResult.comment.trim();
              if (nextComment) {
                comments = { ...comments, [node.id]: nextComment };
              } else {
                const nextComments = { ...comments };
                delete nextComments[node.id];
                comments = nextComments;
              }

              component.setComment(node.id, nextComment);
              pi.appendEntry(
                ASSISTANT_OUTLINE_COMMENTS_TYPE,
                buildCommentState(currentDocument.messageEntryId, comments),
              );
              tui.requestRender(true);
            },
          });

          component.setLoadedDocument(currentDocument, currentTimestamp);
          void component.init();
          return component;
        },
        {
          overlay: true,
          overlayOptions: OVERLAY_OPTIONS,
        },
      );

      if (exportedSections) {
        ctx.ui.setEditorText(exportedSections.text);
        const noun =
          exportedSections.kind === "commands"
            ? "command snippet"
            : "assistant outline section";
        ctx.ui.notify(
          `Loaded ${exportedSections.count} ${noun}${exportedSections.count === 1 ? "" : "s"} into the editor`,
          "info",
        );
      }
    },
  });
}
