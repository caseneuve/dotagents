import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const COMMAND_NAME = "diff-review";
const REVIEW_DIR = path.join(os.tmpdir(), "pi-diff-reviews");

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

function diffInsertedGroups(
  baseLines: string[],
  reviewLines: string[],
): Array<{ afterBaseIndex: number; lines: string[] }> {
  const groups: Array<{ afterBaseIndex: number; lines: string[] }> = [];
  let baseIndex = 0;
  let reviewIndex = 0;

  while (reviewIndex < reviewLines.length) {
    if (
      baseIndex < baseLines.length &&
      reviewLines[reviewIndex] === baseLines[baseIndex]
    ) {
      baseIndex += 1;
      reviewIndex += 1;
      continue;
    }

    let nextBaseIndex = -1;
    for (let i = baseIndex + 1; i < baseLines.length; i += 1) {
      if (baseLines[i] === reviewLines[reviewIndex]) {
        nextBaseIndex = i;
        break;
      }
    }

    if (nextBaseIndex !== -1) {
      baseIndex = nextBaseIndex;
      continue;
    }

    const inserted: string[] = [];
    const afterBaseIndex = baseIndex - 1;
    while (reviewIndex < reviewLines.length) {
      const nextReviewLine = reviewLines[reviewIndex];
      if (
        baseIndex < baseLines.length &&
        nextReviewLine === baseLines[baseIndex]
      )
        break;
      inserted.push(nextReviewLine);
      reviewIndex += 1;
    }

    const bodyLines = inserted.filter((line) => line.trim() !== "");
    if (bodyLines.length > 0) {
      groups.push({ afterBaseIndex, lines: bodyLines });
    }
  }

  return groups;
}

function anchorForBaseIndex(
  baseLines: string[],
  afterBaseIndex: number,
): Omit<ReviewComment, "body"> {
  let currentFile: string | undefined;
  let currentHunk: string | undefined;

  for (let i = 0; i <= afterBaseIndex && i < baseLines.length; i += 1) {
    const line = baseLines[i];
    const fileMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (fileMatch) {
      currentFile = fileMatch[2];
      currentHunk = undefined;
      continue;
    }
    if (line.startsWith("@@ ")) {
      currentHunk = line;
    }
  }

  return {
    file: currentFile,
    hunk: currentHunk,
    ...parseHunkStart(currentHunk ?? ""),
  };
}

function parseReviewComments(base: string, review: string): ReviewComment[] {
  const baseLines = base.split(/\r?\n/);
  const reviewLines = review.split(/\r?\n/);

  return diffInsertedGroups(baseLines, reviewLines).map((group) => ({
    ...anchorForBaseIndex(baseLines, group.afterBaseIndex),
    body: group.lines.join("\n").trim(),
  }));
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
      const basePath = path.join(REVIEW_DIR, `${reviewBase}.base.diff`);
      const reviewPath = path.join(REVIEW_DIR, `${reviewBase}.review.diff`);
      const commentsPath = path.join(REVIEW_DIR, `${reviewBase}.comments.md`);
      const reviewBuffer = buildReviewBuffer(diff);
      writeFileSync(basePath, reviewBuffer, "utf8");
      writeFileSync(reviewPath, reviewBuffer, "utf8");

      ctx.ui.notify(`Opening ${reviewPath}`, "info");
      const result = openEditor(editorCommand, reviewPath);
      if (!result.ok) {
        ctx.ui.notify(`Failed to open editor: ${result.message}`, "error");
        return;
      }

      const original = readFileSync(basePath, "utf8");
      const edited = readFileSync(reviewPath, "utf8");
      const comments = parseReviewComments(original, edited);
      if (comments.length === 0) {
        ctx.ui.notify(
          "No inline comments found; nothing sent to agent",
          "info",
        );
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
