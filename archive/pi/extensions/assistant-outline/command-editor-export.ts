import type { SectionComments } from "./types";
import type { CommandSnippet } from "./command-extract";

function formatComment(comment: string): string[] {
  return comment
    .split(/\r?\n/)
    .map((line, index) =>
      `# ${index === 0 ? "Comment: " : ""}${line}`.trimEnd(),
    );
}

function formatCommandSnippetBody(
  snippet: CommandSnippet,
  comments: SectionComments,
): string {
  const lines = [`# ${snippet.path}`];
  const comment = comments[snippet.nodeId]?.trim();
  if (comment) lines.push(...formatComment(comment));
  lines.push(snippet.commandText);
  return `${lines.join("\n")}\n`;
}

export function formatCommandSnippetForPiEditor(
  snippet: CommandSnippet,
  comments: SectionComments,
): string {
  return formatCommandSnippetBody(snippet, comments);
}

export function formatMarkedCommandsForPiEditor(
  snippets: CommandSnippet[],
  comments: SectionComments,
): string {
  if (snippets.length === 0) return "";

  const body = snippets
    .map((snippet) => formatCommandSnippetBody(snippet, comments).trimEnd())
    .join("\n\n");

  return (
    "# command snippets from the last assistant response\n\n" +
    "Please use these command snippets for the follow-up discussion:\n\n" +
    body +
    "\n"
  );
}
