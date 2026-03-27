import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  ASSISTANT_OUTLINE_COMMENTS_TYPE,
  buildCommentState,
  getStoredCommentsForMessage,
} from "./comments";
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

            return { document: currentDocument, timestamp: currentTimestamp };
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
        ctx.ui.notify(
          `Loaded ${exportedSections.count} assistant outline section${exportedSections.count === 1 ? "" : "s"} into the editor`,
          "info",
        );
      }
    },
  });
}
