import type { SectionComments } from "./types";
import type { CommandSnippet } from "./command-extract";
import { formatCommandSnippetForPiEditor } from "./command-editor-export";

const SHEBANG = "#!/usr/bin/env bash";

function stripLeadingShebang(text: string): string {
  return text.replace(/^#![^\n]*\n+/, "");
}

function withShebang(text: string): string {
  return `${SHEBANG}\n\n${stripLeadingShebang(text)}`;
}

export function formatCommandSnippetForEditor(
  snippet: CommandSnippet,
  comments: SectionComments,
): string {
  return withShebang(formatCommandSnippetForPiEditor(snippet, comments));
}

export function formatAllCommandsForEditor(
  snippets: CommandSnippet[],
  comments: SectionComments,
): string {
  if (snippets.length === 0) {
    return withShebang(
      "# commands from the last assistant response\n\n# No shell-like command snippets were found.\n",
    );
  }

  const body = snippets
    .map((snippet) =>
      stripLeadingShebang(
        formatCommandSnippetForPiEditor(snippet, comments).trimEnd(),
      ),
    )
    .join("\n\n");

  return withShebang(
    `# commands from the last assistant response\n\n${body}\n`,
  );
}
