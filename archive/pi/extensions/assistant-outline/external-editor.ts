import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

type EditCommentParams = {
  title: string;
  markdown: string;
  existingComment: string;
};

type EditCommentResult =
  | { ok: true; comment: string }
  | { ok: false; reason: "missing-editor" | "editor-error"; message: string };

const COMMENT_MARKER = "<!-- assistant-outline-comment -->";

function buildEditorBuffer(params: EditCommentParams): string {
  const comment = params.existingComment.trim();
  return [
    `# ${params.title}`,
    "#",
    "# The section content below is reference text from the last assistant response.",
    "# Edit only the comment block after the marker.",
    "",
    "---",
    "",
    params.markdown,
    "",
    COMMENT_MARKER,
    comment,
    "",
  ].join("\n");
}

function parseComment(buffer: string): string {
  const markerIndex = buffer.indexOf(COMMENT_MARKER);
  if (markerIndex < 0) return "";
  return buffer.slice(markerIndex + COMMENT_MARKER.length).trim();
}

export async function editSectionComment(
  params: EditCommentParams,
): Promise<EditCommentResult> {
  const editorCommand = process.env.VISUAL || process.env.EDITOR;
  if (!editorCommand) {
    return {
      ok: false,
      reason: "missing-editor",
      message: "Set $VISUAL or $EDITOR to edit assistant-outline comments",
    };
  }

  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "assistant-outline-"),
  );
  const tempPath = path.join(tempDir, "section.md");
  await fs.writeFile(tempPath, buildEditorBuffer(params), "utf8");

  try {
    const [editor, ...editorArgs] = editorCommand.split(" ");
    const result = spawnSync(editor, [...editorArgs, tempPath], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    if (result.status && result.status !== 0) {
      return {
        ok: false,
        reason: "editor-error",
        message: `Editor exited with code ${result.status}`,
      };
    }

    const nextBuffer = await fs.readFile(tempPath, "utf8");
    return {
      ok: true,
      comment: parseComment(nextBuffer),
    };
  } catch (error) {
    return {
      ok: false,
      reason: "editor-error",
      message: `Failed to open editor: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
