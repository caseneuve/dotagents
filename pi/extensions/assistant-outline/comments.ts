import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { getNodePath } from "./markdown-outline";
import type {
  AssistantOutlineCommentState,
  ExportedSectionsPayload,
  ParsedAssistantOutline,
  SectionComments,
} from "./types";

export const ASSISTANT_OUTLINE_COMMENTS_TYPE = "assistant-outline-comments";

type CommentCustomEntry = SessionEntry & {
  type: "custom";
  customType?: string;
  data?: {
    messageEntryId?: string;
    comments?: Record<string, unknown>;
  };
};

export function getStoredCommentsForMessage(
  branch: SessionEntry[],
  messageEntryId: string,
): SectionComments {
  let comments: SectionComments = {};

  for (const entry of branch) {
    const customEntry = entry as CommentCustomEntry;
    if (customEntry.type !== "custom") continue;
    if (customEntry.customType !== ASSISTANT_OUTLINE_COMMENTS_TYPE) continue;
    if (customEntry.data?.messageEntryId !== messageEntryId) continue;

    const nextComments = customEntry.data?.comments ?? {};
    comments = Object.fromEntries(
      Object.entries(nextComments)
        .filter(
          ([key, value]) =>
            typeof key === "string" && typeof value === "string",
        )
        .map(([key, value]) => [key, value.trim()]),
    );
  }

  return comments;
}

export function buildCommentState(
  messageEntryId: string,
  comments: SectionComments,
): AssistantOutlineCommentState {
  return {
    messageEntryId,
    comments: Object.fromEntries(
      Object.entries(comments)
        .map(([key, value]) => [key, value.trim()])
        .filter(([, value]) => Boolean(value)),
    ),
  };
}

export function buildExportedSectionsPayload(
  document: ParsedAssistantOutline,
  markedIds: ReadonlySet<string>,
  comments: SectionComments,
): ExportedSectionsPayload | undefined {
  if (markedIds.size === 0) return undefined;

  const sections = [...markedIds]
    .map((id) => document.nodesById.get(id))
    .filter((node): node is NonNullable<typeof node> => Boolean(node))
    .map((node) => ({
      node,
      path: getNodePath(document, node.id).join(" > "),
      comment: comments[node.id]?.trim() ?? "",
    }))
    .sort((a, b) => a.node.startLine - b.node.startLine);

  if (sections.length === 0) return undefined;

  const hasAnyComments = sections.some((section) => Boolean(section.comment));
  const body = sections
    .map((section) => {
      if (!section.comment) return `- ${section.path}`;
      return `- ${section.path}\n  Comment: ${section.comment.replace(/\r?\n/g, "\n  ")}`;
    })
    .join("\n\n");

  return {
    count: sections.length,
    text:
      (hasAnyComments
        ? "# comments on the last assistant response\n\nPlease revise or answer with these section-targeted comments:\n\n"
        : "# sections from the last assistant response\n\nPlease focus on these sections from your last response:\n\n") +
      body +
      "\n",
  };
}
