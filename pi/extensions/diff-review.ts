import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

const COMMAND_NAME = "diff";

const FIXED_ARG_ALIASES: Record<string, { args: string; description: string }> =
  {
    "diff-dirty": {
      args: "dirty-all",
      description: "Review staged + unstaged + untracked changes",
    },
    "diff-staged": {
      args: "staged",
      description: "Review staged changes only",
    },
    "diff-latest": { args: "latest", description: "Review HEAD~1..HEAD" },
    "diff-vs-master": {
      args: "master",
      description: "Review current branch against master",
    },
  };
const REVIEW_DIR = path.join(os.tmpdir(), "pi-diff-reviews");

type DiffMode = "worktree" | "staged" | "dirty" | "dirty-all";

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
  if (trimmed === "latest") {
    return { ok: true, mode: "worktree", revspec: "HEAD~1..HEAD" };
  }
  if (trimmed === "master" || trimmed === "branch") {
    return { ok: true, mode: "worktree", revspec: "master...HEAD" };
  }
  if (/^\d+$/.test(trimmed)) {
    return { ok: true, mode: "worktree", revspec: `HEAD~${trimmed}..HEAD` };
  }
  if (trimmed === "staged" || trimmed === "--staged") {
    return { ok: true, mode: "staged" };
  }
  if (trimmed === "dirty") {
    return { ok: true, mode: "dirty" };
  }
  if (trimmed === "dirty-all") {
    return { ok: true, mode: "dirty-all" };
  }
  if (trimmed.includes("\n")) {
    return {
      ok: false,
      message: "Diff review accepts a single git revision argument.",
    };
  }
  return { ok: true, mode: "worktree", revspec: trimmed };
}

type GitResult = { ok: true; stdout: string } | { ok: false; message: string };

function git(args: string[], cwd = process.cwd()): GitResult {
  try {
    const stdout = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });
    return { ok: true, stdout };
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "git diff failed";
    return { ok: false, message };
  }
}

function diffArgs(parsed: Extract<ParsedArgs, { ok: true }>): string[] {
  const common = ["diff", "--find-renames", "--find-copies"];
  if (parsed.mode === "staged") return [...common, "--cached"];
  if (parsed.mode === "dirty" || parsed.mode === "dirty-all")
    return [...common, "HEAD"];
  if (parsed.revspec) return [...common, parsed.revspec];
  return common;
}

function gitOutputAllowingDiffExit(
  args: string[],
  cwd = process.cwd(),
): GitResult {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5000,
  });

  if (result.error) {
    return { ok: false, message: result.error.message };
  }

  if (result.status === 0 || result.status === 1) {
    return { ok: true, stdout: result.stdout ?? "" };
  }

  return { ok: false, message: (result.stderr || "git command failed").trim() };
}

function buildUntrackedDiff(cwd = process.cwd()): GitResult {
  const list = git(["ls-files", "--others", "--exclude-standard"], cwd);
  if (!list.ok) return list;

  const files = list.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (files.length === 0) return { ok: true, stdout: "" };

  const chunks: string[] = [];
  for (const file of files) {
    const patch = gitOutputAllowingDiffExit(
      ["diff", "--no-index", "--", "/dev/null", file],
      cwd,
    );
    if (!patch.ok) return patch;
    if (patch.stdout.trim()) chunks.push(patch.stdout.trimEnd());
  }

  return {
    ok: true,
    stdout: chunks.join("\n\n") + (chunks.length ? "\n" : ""),
  };
}

function prefixDiffPaths(diff: string, prefix: string): string {
  const normalizedPrefix = prefix.replace(/\/+$/, "");
  if (!normalizedPrefix) return diff;

  return diff
    .split(/\r?\n/)
    .map((line) => {
      const gitMatch = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      if (gitMatch) {
        return `diff --git a/${normalizedPrefix}/${gitMatch[1]} b/${normalizedPrefix}/${gitMatch[2]}`;
      }
      const fileMatch = /^(---|\+\+\+) ([ab])\/(.+)$/.exec(line);
      if (fileMatch) {
        return `${fileMatch[1]} ${fileMatch[2]}/${normalizedPrefix}/${fileMatch[3]}`;
      }
      return line;
    })
    .join("\n");
}

function listSubmodulePaths(): GitResult {
  const status = git(["submodule", "status", "--recursive"]);
  if (!status.ok) return status;

  const paths = status.stdout
    .split(/\r?\n/)
    .map((line) => /^.\S+\s+(\S+)/.exec(line)?.[1])
    .filter((submodulePath): submodulePath is string => Boolean(submodulePath));

  return { ok: true, stdout: paths.join("\n") };
}

function buildSubmoduleDiffs(
  parsed: Extract<ParsedArgs, { ok: true }>,
): GitResult {
  if (parsed.mode !== "dirty" && parsed.mode !== "dirty-all") {
    return { ok: true, stdout: "" };
  }

  const paths = listSubmodulePaths();
  if (!paths.ok) return paths;

  const chunks: string[] = [];
  for (const submodulePath of paths.stdout.split(/\r?\n/).filter(Boolean)) {
    const cwd = path.join(process.cwd(), submodulePath);
    const tracked = git(diffArgs(parsed), cwd);
    if (!tracked.ok) {
      return {
        ok: false,
        message: `failed to read submodule ${submodulePath}: ${tracked.message}`,
      };
    }
    if (tracked.stdout.trim()) {
      chunks.push(prefixDiffPaths(tracked.stdout.trimEnd(), submodulePath));
    }

    if (parsed.mode === "dirty-all") {
      const untracked = buildUntrackedDiff(cwd);
      if (!untracked.ok) {
        return {
          ok: false,
          message: `failed to read untracked files in submodule ${submodulePath}: ${untracked.message}`,
        };
      }
      if (untracked.stdout.trim()) {
        chunks.push(prefixDiffPaths(untracked.stdout.trimEnd(), submodulePath));
      }
    }
  }

  return {
    ok: true,
    stdout: chunks.join("\n\n") + (chunks.length ? "\n" : ""),
  };
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

function runDiff(basePath: string, reviewPath: string): string {
  const result = spawnSync("diff", ["-U0", basePath, reviewPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.stdout ?? "";
}

function isDiffMetadataLine(line: string): boolean {
  return (
    line.startsWith("diff --git ") ||
    line.startsWith("index ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ") ||
    line.startsWith("old mode ") ||
    line.startsWith("new mode ") ||
    line.startsWith("similarity index ") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("@@ ") ||
    line === "# Local Variables:" ||
    line === "# mode: diff" ||
    line === "# End:"
  );
}

function parseInsertedGroupsFromDiff(
  diff: string,
): Array<{ afterBaseIndex: number; lines: string[] }> {
  const groups: Array<{ afterBaseIndex: number; lines: string[] }> = [];
  const lines = diff.split(/\r?\n/);
  let current: { afterBaseIndex: number; lines: string[] } | undefined;

  for (const line of lines) {
    const hunkMatch = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(line);
    if (hunkMatch) {
      if (current && current.lines.length > 0) groups.push(current);
      const oldStart = Number.parseInt(hunkMatch[1], 10);
      const oldCount = hunkMatch[2] ? Number.parseInt(hunkMatch[2], 10) : 1;
      current = { afterBaseIndex: oldStart + oldCount - 2, lines: [] };
      continue;
    }

    if (!current || line.startsWith("---") || line.startsWith("+++")) continue;
    if (line.startsWith("+")) {
      const inserted = line.slice(1);
      if (inserted.trim() && !isDiffMetadataLine(inserted)) {
        current.lines.push(inserted);
      }
    }
  }

  if (current && current.lines.length > 0) groups.push(current);
  return groups;
}

function anchorForBaseIndex(
  baseLines: string[],
  afterBaseIndex: number,
): Omit<ReviewComment, "body"> {
  let currentFile: string | undefined;
  let currentHunk: string | undefined;
  let oldLine: number | undefined;
  let newLine: number | undefined;
  let lastOldLine: number | undefined;
  let lastNewLine: number | undefined;

  for (let i = 0; i <= afterBaseIndex && i < baseLines.length; i += 1) {
    const line = baseLines[i];
    const fileMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (fileMatch) {
      currentFile = fileMatch[2];
      currentHunk = undefined;
      oldLine = undefined;
      newLine = undefined;
      lastOldLine = undefined;
      lastNewLine = undefined;
      continue;
    }

    const hunkMatch = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunkMatch) {
      currentHunk = line;
      oldLine = Number.parseInt(hunkMatch[1], 10);
      newLine = Number.parseInt(hunkMatch[2], 10);
      lastOldLine = oldLine;
      lastNewLine = newLine;
      continue;
    }

    if (oldLine === undefined || newLine === undefined) continue;
    if (line.startsWith("\\")) continue;

    if (line.startsWith("-")) {
      lastOldLine = oldLine;
      oldLine += 1;
      continue;
    }

    if (line.startsWith("+")) {
      lastNewLine = newLine;
      newLine += 1;
      continue;
    }

    lastOldLine = oldLine;
    lastNewLine = newLine;
    oldLine += 1;
    newLine += 1;
  }

  return {
    file: currentFile,
    hunk: currentHunk,
    oldLine: lastOldLine ?? parseHunkStart(currentHunk ?? "").oldLine,
    newLine: lastNewLine ?? parseHunkStart(currentHunk ?? "").newLine,
  };
}

function parseReviewComments(base: string, editDiff: string): ReviewComment[] {
  const baseLines = base.split(/\r?\n/);

  return parseInsertedGroupsFromDiff(editDiff).map((group) => ({
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
  async function runDiffReview(
    args: string,
    ctx: ExtensionCommandContext,
    commandName: string,
  ) {
    try {
      if (!ctx.hasUI) {
        ctx.ui.notify(`/${commandName} requires interactive mode`, "error");
        return;
      }

      const parsed = parseArgs(args);
      if (!parsed.ok) {
        ctx.ui.notify(parsed.message, "warning");
        return;
      }

      const diffResult = git(diffArgs(parsed));
      if (!diffResult.ok) {
        ctx.ui.notify(
          `Failed to read git diff: ${diffResult.message}`,
          "error",
        );
        return;
      }

      let diff = diffResult.stdout;
      if (parsed.mode === "dirty-all") {
        const untracked = buildUntrackedDiff();
        if (!untracked.ok) {
          ctx.ui.notify(
            `Failed to read untracked file diffs: ${untracked.message}`,
            "error",
          );
          return;
        }
        if (untracked.stdout.trim()) {
          diff = diff.trim()
            ? `${diff.trimEnd()}\n\n${untracked.stdout.trimEnd()}\n`
            : `${untracked.stdout.trimEnd()}\n`;
        }
      }

      const submodules = buildSubmoduleDiffs(parsed);
      if (!submodules.ok) {
        ctx.ui.notify(
          `Failed to read submodule diffs: ${submodules.message}`,
          "error",
        );
        return;
      }
      if (submodules.stdout.trim()) {
        diff = diff.trim()
          ? `${diff.trimEnd()}\n\n${submodules.stdout.trimEnd()}\n`
          : `${submodules.stdout.trimEnd()}\n`;
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
      const target = parsed.revspec ?? parsed.mode;
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
      const editDiff = runDiff(basePath, reviewPath);
      const comments = parseReviewComments(original, editDiff);
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
        "info",
      );
    } catch (error) {
      ctx.ui.notify(
        `/${commandName} failed: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  pi.registerCommand(COMMAND_NAME, {
    description:
      "Open the current git diff in $EDITOR and send structured review comments back to the agent",
    getArgumentCompletions: (prefix) => {
      // Build completions from FIXED_ARG_ALIASES first, then add extras
      const aliasCompletions = Object.values(FIXED_ARG_ALIASES).map(
        ({ args, description }) => ({
          label: args,
          value: args,
          description: description.replace(/^Review\s+/i, ""),
        }),
      );
      const extraCompletions = [
        {
          label: "dirty",
          value: "dirty",
          description: "staged + unstaged tracked changes against HEAD",
        },
        { label: "2", value: "2", description: "review HEAD~2..HEAD" },
        { label: "3", value: "3", description: "review HEAD~3..HEAD" },
      ];
      const options = [...aliasCompletions, ...extraCompletions];
      return options.filter((option) =>
        option.value.startsWith(prefix.toLowerCase()),
      );
    },
    handler: async (args, ctx) => runDiffReview(args, ctx, COMMAND_NAME),
  });

  for (const [name, { args, description }] of Object.entries(
    FIXED_ARG_ALIASES,
  )) {
    pi.registerCommand(name, {
      description,
      handler: async (_args, ctx) => runDiffReview(args, ctx, name),
    });
  }
}
