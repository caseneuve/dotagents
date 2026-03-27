import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
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
import { getLatestAssistantResponse } from "./session";
import type { ParsedAssistantOutline, SectionComments } from "./types";

const COMMAND_NAME = "assistant-outline";

export default function assistantOutlineExtension(pi: ExtensionAPI) {
  pi.registerCommand(COMMAND_NAME, {
    description:
      "Browse the latest assistant response as a markdown outline with section preview/comments",
    handler: async (_args, ctx) => {
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

      const branch = ctx.sessionManager.getBranch();
      const latest = getLatestAssistantResponse(branch);
      if (!latest.selection) {
        ctx.ui.notify(latest.error ?? "No assistant response found", "warning");
        return;
      }

      let currentDocument: ParsedAssistantOutline | undefined =
        parseAssistantOutline(
          latest.selection.text,
          latest.selection.messageEntryId,
        );
      let currentTimestamp = latest.selection.timestamp;
      let comments: SectionComments = getStoredCommentsForMessage(
        branch,
        latest.selection.messageEntryId,
      );
      let commandSnippets: CommandSnippet[] =
        extractCommandSnippets(currentDocument);

      const exportedSections = await ctx.ui.custom(
        (tui, theme, _kb, done) => {
          const reloadDocument = async () => {
            const nextLatest = getLatestAssistantResponse(
              ctx.sessionManager.getBranch(),
            );
            if (!nextLatest.selection) {
              return {
                error: nextLatest.error ?? "No assistant response found",
              };
            }

            currentDocument = parseAssistantOutline(
              nextLatest.selection.text,
              nextLatest.selection.messageEntryId,
            );
            currentTimestamp = nextLatest.selection.timestamp;
            comments = getStoredCommentsForMessage(
              ctx.sessionManager.getBranch(),
              nextLatest.selection.messageEntryId,
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
