import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const COMMAND_NAME = "diff-review";
const REVIEW_DIR = path.join(os.tmpdir(), "pi-diff-reviews");
const INLINE_COMMENT_RE = /^\s*(?:(?:#|;|\/\/)\s*)?REVIEW:\s?(.*)$/i;

type DiffMode = "worktree" | "staged";

type ReviewComment = {
  file?: string;
  hunk?: string;
  newLine?: number;
  oldLine?: number;
  body: string;
};

type ParsedArgs =
  | { ok: true; mode: DiffMode; revspec?: string }
  | { ok: false; message: string };

function parseArgs(args: string): ParsedArgs {
  const trimmed = args.trim();
  if (!trimmed) return { ok: true, mode: "worktree" };
  if (trimmed === "staged" || trimmed === "--staged") {
    return { ok: true, mode: "staged" };
  }
  if (trimmed.includes("\n")) {
    return {
      ok: false,
      message: "Diff review accepts a single git revision argument.",
    };
  }
  return { ok: true, mode: "worktree", revspec: trimmed };
}

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });
  } catch {
    return null;
  }
}

function diffArgs(parsed: Extract<ParsedArgs, { ok: true }>): string[] {
  const common = ["diff", "--find-renames", "--find-copies"];
  if (parsed.mode === "staged") return [...common, "--cached"];
  if (parsed.revspec) return [...common, parsed.revspec];
  return common;
}

function timestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function buildReviewBuffer(diff: string): string {
  return [
    diff.trimEnd(),
    "",
    "# Local Variables:",
    "# mode: diff",
    "# End:",
  ].join("\n");
}

function parseHunkStart(hunk: string): { oldLine?: number; newLine?: number } {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(hunk);
  if (!match) return {};
  return {
    oldLine: Number.parseInt(match[1], 10),
    newLine: Number.parseInt(match[2], 10),
  };
}

function parseReviewComments(buffer: string): ReviewComment[] {
  const comments: ReviewComment[] = [];
  const lines = buffer.split(/\r?\n/);
  let currentFile: string | undefined;
  let currentHunk: string | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fileMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (fileMatch) {
      currentFile = fileMatch[2];
      currentHunk = undefined;
      continue;
    }
    if (line.startsWith("@@ ")) {
      currentHunk = line;
      continue;
    }
    const inlineComment = INLINE_COMMENT_RE.exec(line);
    if (!inlineComment) continue;

    const bodyLines: string[] = [inlineComment[1]];
    while (i + 1 < lines.length) {
      const nextInlineComment = INLINE_COMMENT_RE.exec(lines[i + 1]);
      if (!nextInlineComment) break;
      i += 1;
      bodyLines.push(nextInlineComment[1]);
    }

    const body = bodyLines.join("\n").trim();
    if (!body) continue;

    comments.push({
      file: currentFile,
      hunk: currentHunk,
      ...parseHunkStart(currentHunk ?? ""),
      body,
    });
  }

  return comments;
}

function renderCommentsForAgent(comments: ReviewComment[]): string {
  const lines = [
    "Human reviewed the current diff and left these comments.",
    "",
  ];

  comments.forEach((comment, index) => {
    const location = comment.file
      ? `${comment.file}${comment.newLine ? `:${comment.newLine}` : ""}`
      : "diff";
    lines.push(`${index + 1}. \`${location}\``);
    if (comment.hunk) lines.push(`   Hunk: \`${comment.hunk}\``);
    for (const bodyLine of comment.body.split("\n")) {
      lines.push(`   ${bodyLine}`.trimEnd());
    }
    lines.push("");
  });

  lines.push("Please address the review comments.");
  return lines.join("\n").trimEnd();
}

function openEditor(
  editorCommand: string,
  filePath: string,
): { ok: true } | { ok: false; message: string } {
  const [editor, ...editorArgs] = editorCommand.split(" ");
  if (!editor) return { ok: false, message: "Invalid editor command" };

  try {
    const result = spawnSync(editor, [...editorArgs, filePath], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (result.status && result.status !== 0) {
      return { ok: false, message: `Editor exited with code ${result.status}` };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export default function diffReviewExtension(pi: ExtensionAPI) {
  pi.registerCommand(COMMAND_NAME, {
    description:
      "Open the current git diff in $EDITOR and send structured review comments back to the agent",
    getArgumentCompletions: (prefix) => {
      const options = ["staged"];
      return options
        .filter((value) => value.startsWith(prefix.toLowerCase()))
        .map((value) => ({ value, description: "review staged changes" }));
    },
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify(`/${COMMAND_NAME} requires interactive mode`, "error");
        return;
      }

      const parsed = parseArgs(args);
      if (!parsed.ok) {
        ctx.ui.notify(parsed.message, "warning");
        return;
      }

      const diff = git(diffArgs(parsed));
      if (diff === null) {
        ctx.ui.notify("Failed to read git diff", "error");
        return;
      }
      if (!diff.trim()) {
        ctx.ui.notify("No diff to review", "info");
        return;
      }

      const editorCommand = process.env.VISUAL || process.env.EDITOR;
      if (!editorCommand) {
        ctx.ui.notify("Set $VISUAL or $EDITOR to review diffs", "warning");
        return;
      }

      mkdirSync(REVIEW_DIR, { recursive: true });
      const target =
        parsed.mode === "staged" ? "staged" : (parsed.revspec ?? "worktree");
      const reviewBase = `${timestamp()}-${target.replace(/[^a-zA-Z0-9._-]+/g, "_")}`;
      const reviewPath = path.join(REVIEW_DIR, `${reviewBase}.diff`);
      const commentsPath = path.join(REVIEW_DIR, `${reviewBase}.comments.md`);
      writeFileSync(reviewPath, buildReviewBuffer(diff), "utf8");

      ctx.ui.notify(`Opening ${reviewPath}`, "info");
      const result = openEditor(editorCommand, reviewPath);
      if (!result.ok) {
        ctx.ui.notify(`Failed to open editor: ${result.message}`, "error");
        return;
      }

      const edited = readFileSync(reviewPath, "utf8");
      const comments = parseReviewComments(edited);
      if (comments.length === 0) {
        ctx.ui.notify("No REVIEW lines found; nothing sent to agent", "info");
        return;
      }

      const renderedComments = renderCommentsForAgent(comments);
      writeFileSync(commentsPath, `${renderedComments}\n`, "utf8");

      pi.sendUserMessage(renderedComments, {
        deliverAs: "followUp",
      });
      ctx.ui.notify(
        `Sent ${comments.length} diff review comment(s) to the agent`,
        "success",
      );
    },
  });
}
