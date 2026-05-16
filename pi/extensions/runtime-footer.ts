import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const MIN_GAP = 2;
const GIT_STATS_TTL_MS = 2000;
const CONFIG_CHECK_TTL_MS = 1000;

const COMMAND_NAME = "runtime-footer-config";
const CONFIG_CHANGED_EVENT = "runtime-footer:config-changed";
const PROJECT_CONFIG_RELATIVE_PATH = ".pi/runtime-footer.json";
const GLOBAL_CONFIG_PATH = path.join(
  os.homedir(),
  ".pi",
  "agent",
  "runtime-footer.json",
);

type GitStats = {
  addedLines: number;
  removedLines: number;
  changedFiles: number;
  addedFiles: number;
  untrackedFiles: number;
};

type GitStatsCache = {
  cwd: string;
  checkedAt: number;
  stats: GitStats | null;
};

type FooterBlockId =
  | "cwd"
  | "git"
  | "session-notes"
  | "comms"
  | "provider"
  | "model"
  | "thinking"
  | "cost"
  | "context";

type RuntimeFooterConfig = {
  left: string[];
  right: string[];
  separator: string;
  branchStatusLine: boolean;
};

type FooterConfigCache = {
  cwd: string;
  checkedAt: number;
  sourcePath: string | null;
  sourceMtimeMs: number | null;
  config: RuntimeFooterConfig;
  error?: string;
};

const DEFAULT_LEFT_BLOCKS: FooterBlockId[] = [
  "cwd",
  "git",
  "session-notes",
  "comms",
];

const DEFAULT_RIGHT_BLOCKS: FooterBlockId[] = [
  "provider",
  "model",
  "thinking",
  "cost",
  "context",
];

const KNOWN_BLOCKS = new Set<FooterBlockId>([
  ...DEFAULT_LEFT_BLOCKS,
  ...DEFAULT_RIGHT_BLOCKS,
]);

function defaultConfig(): RuntimeFooterConfig {
  return {
    left: [...DEFAULT_LEFT_BLOCKS],
    right: [...DEFAULT_RIGHT_BLOCKS],
    separator: " · ",
    branchStatusLine: true,
  };
}

function defaultConfigText(): string {
  return `${JSON.stringify(defaultConfig(), null, 2)}\n`;
}

function parseConfig(value: unknown): RuntimeFooterConfig | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const base = defaultConfig();
  const data = value as {
    left?: unknown;
    right?: unknown;
    separator?: unknown;
    branchStatusLine?: unknown;
  };

  const parseSide = (side: unknown, fallback: string[]): string[] => {
    if (!Array.isArray(side)) return fallback;
    return side.filter((item): item is string => typeof item === "string");
  };

  return {
    left: parseSide(data.left, base.left),
    right: parseSide(data.right, base.right),
    separator:
      typeof data.separator === "string" ? data.separator : base.separator,
    branchStatusLine:
      typeof data.branchStatusLine === "boolean"
        ? data.branchStatusLine
        : base.branchStatusLine,
  };
}

function projectConfigPath(cwd: string): string {
  return path.join(cwd, PROJECT_CONFIG_RELATIVE_PATH);
}

function resolveConfigSourcePath(cwd: string): string | null {
  const projectPath = projectConfigPath(cwd);
  if (existsSync(projectPath)) return projectPath;
  if (existsSync(GLOBAL_CONFIG_PATH)) return GLOBAL_CONFIG_PATH;
  return null;
}

function readFooterConfig(
  cwd: string,
  previous: FooterConfigCache | undefined,
): FooterConfigCache {
  const now = Date.now();

  if (
    previous &&
    previous.cwd === cwd &&
    now - previous.checkedAt < CONFIG_CHECK_TTL_MS
  ) {
    return previous;
  }

  const sourcePath = resolveConfigSourcePath(cwd);
  const fallback = defaultConfig();

  if (!sourcePath) {
    return {
      cwd,
      checkedAt: now,
      sourcePath: null,
      sourceMtimeMs: null,
      config: fallback,
    };
  }

  let sourceMtimeMs: number | null;
  try {
    sourceMtimeMs = statSync(sourcePath).mtimeMs;
  } catch {
    sourceMtimeMs = null;
  }

  if (
    previous &&
    previous.cwd === cwd &&
    previous.sourcePath === sourcePath &&
    previous.sourceMtimeMs === sourceMtimeMs
  ) {
    return { ...previous, checkedAt: now };
  }

  try {
    const raw = JSON.parse(readFileSync(sourcePath, "utf8"));
    const parsed = parseConfig(raw);
    if (!parsed) {
      throw new Error("config root must be an object");
    }

    return {
      cwd,
      checkedAt: now,
      sourcePath,
      sourceMtimeMs,
      config: parsed,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      cwd,
      checkedAt: now,
      sourcePath,
      sourceMtimeMs,
      config: fallback,
      error: `${sourcePath}: ${message}`,
    };
  }
}

function formatCwd(): string {
  const cwd = process.cwd();
  const home = process.env.HOME;
  if (home && cwd.startsWith(home)) {
    return `~${cwd.slice(home.length)}` || "~";
  }
  return cwd;
}

const PROVIDER_SHORT: Record<string, string> = {
  "amazon-bedrock": "bedrock",
  "azure-openai": "azure",
  "google-vertex": "vertex",
  "openai-codex": "openai",
};

function shortenProvider(raw: string): string {
  return PROVIDER_SHORT[raw] ?? raw;
}

/**
 * Strip noisy prefixes and date/version suffixes from model IDs.
 *
 *   us.anthropic.claude-sonnet-4-20250514-v1:0  →  claude-sonnet-4
 *   anthropic/claude-opus-4-20250514-v1:0       →  claude-opus-4
 *   eu.anthropic.claude-3-5-haiku-20241022-v1:0 →  claude-3-5-haiku
 *   gpt-4.1-2025-04-14                          →  gpt-4.1
 */
function shortenModelId(raw: string): string {
  let id = raw;

  // Strip region+vendor dot-prefix  (e.g. "us.anthropic.")
  id = id.replace(/^[a-z]{2,4}\.[a-z]+\./, "");

  // Strip slash-prefix (e.g. "anthropic/")
  id = id.replace(/^[^/]+\//, "");

  // Strip date stamp + optional version tag at the end
  //   -20250514-v1:0 | -20241022-v1:0 | -2025-04-14
  id = id.replace(/-\d{4,}[-]?\d{2,}[-]?\d{2,}.*$/, "");

  return id || raw;
}

function formatProvider(ctx: ExtensionContext): string {
  return shortenProvider(ctx.model?.provider ?? "no-provider");
}

function formatModel(ctx: ExtensionContext): string {
  return shortenModelId(ctx.model?.id ?? "no-model");
}

function formatThinking(pi: ExtensionAPI): string {
  return pi.getThinkingLevel();
}

function runGit(args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 500,
    });
  } catch {
    return null;
  }
}

function emptyGitStats(): GitStats {
  return {
    addedLines: 0,
    removedLines: 0,
    changedFiles: 0,
    addedFiles: 0,
    untrackedFiles: 0,
  };
}

function readGitStats(): GitStats | null {
  const status = runGit(["status", "--porcelain=v1"]);
  if (status === null) {
    return null;
  }

  const stats = emptyGitStats();
  for (const line of status.split("\n")) {
    if (!line) continue;

    const x = line[0];
    const y = line[1];
    if (x === "?" && y === "?") {
      stats.untrackedFiles += 1;
      continue;
    }

    stats.changedFiles += 1;
    if (x === "A" || y === "A") {
      stats.addedFiles += 1;
    }
  }

  const numstat = runGit(["diff", "--numstat", "HEAD", "--"]);
  if (numstat !== null) {
    for (const line of numstat.split("\n")) {
      if (!line) continue;
      const [added, removed] = line.split("\t");
      if (added !== "-") {
        stats.addedLines += Number.parseInt(added, 10) || 0;
      }
      if (removed !== "-") {
        stats.removedLines += Number.parseInt(removed, 10) || 0;
      }
    }
  }

  if (
    stats.addedLines === 0 &&
    stats.removedLines === 0 &&
    stats.changedFiles === 0 &&
    stats.addedFiles === 0 &&
    stats.untrackedFiles === 0
  ) {
    return null;
  }

  return stats;
}

function getGitStats(cache: GitStatsCache | undefined): GitStatsCache {
  const now = Date.now();
  const cwd = process.cwd();
  if (cache && cache.cwd === cwd && now - cache.checkedAt < GIT_STATS_TTL_MS) {
    return cache;
  }

  return {
    cwd,
    checkedAt: now,
    stats: readGitStats(),
  };
}

function formatGitStats(
  theme: ExtensionContext["ui"]["theme"],
  stats: GitStats | null,
): string | null {
  if (!stats) return null;

  const fileParts = [theme.fg("dim", String(stats.changedFiles))];
  if (stats.addedFiles > 0) {
    fileParts.push(theme.fg("success", `A${stats.addedFiles}`));
  }
  if (stats.untrackedFiles > 0) {
    fileParts.push(theme.fg("warning", `?${stats.untrackedFiles}`));
  }

  return `${theme.fg("dim", "[")}${theme.fg(
    "success",
    `+${stats.addedLines}`,
  )}${theme.fg("dim", "/")}${theme.fg(
    "error",
    `-${stats.removedLines}`,
  )} ${theme.fg("dim", "(")}${fileParts.join(theme.fg("dim", ", "))}${theme.fg(
    "dim",
    ")]",
  )}`;
}

function formatCost(ctx: ExtensionContext): string | null {
  let cost = 0;

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      const message = entry.message as AssistantMessage;
      cost += message.usage?.cost?.total ?? 0;
    }
  }

  if (cost <= 0) {
    return null;
  }

  return `$${cost.toFixed(cost >= 10 ? 1 : 2)}`;
}

function formatContextUsage(
  ctx: ExtensionContext,
  theme: ExtensionContext["ui"]["theme"],
): string | null {
  const usage = ctx.getContextUsage?.();
  const contextWindow = (ctx.model as { contextWindow?: number } | undefined)
    ?.contextWindow;

  if (!usage || usage.tokens === null || !contextWindow || contextWindow <= 0) {
    return null;
  }

  const percent = Math.max(
    0,
    Math.min(999, Math.round((usage.tokens / contextWindow) * 100)),
  );
  const text = `${percent}%`;

  if (percent >= 90) {
    return theme.fg("error", text);
  }
  if (percent >= 80) {
    return theme.fg("warning", text);
  }
  return theme.fg("dim", text);
}

type RenderBlockParams = {
  blockId: FooterBlockId;
  theme: ExtensionContext["ui"]["theme"];
  ctx: ExtensionContext;
  pi: ExtensionAPI;
  gitBranch: string | null;
  gitStats: GitStats | null;
  statuses: Map<string, string | undefined>;
  commsActive: boolean;
};

function renderBlock(params: RenderBlockParams): string | undefined {
  const {
    blockId,
    theme,
    ctx,
    pi,
    gitBranch,
    gitStats,
    statuses,
    commsActive,
  } = params;

  switch (blockId) {
    case "cwd":
      return theme.fg("dim", formatCwd());
    case "git": {
      if (!gitBranch) return undefined;
      const branch = theme.fg("dim", gitBranch);
      const stats = formatGitStats(theme, gitStats);
      return stats ? `${branch} ${stats}` : branch;
    }
    case "session-notes": {
      const status = statuses.get("session-notes");
      return status ? theme.fg("dim", status) : undefined;
    }
    case "comms":
      return commsActive ? theme.fg("accent", "📡") : undefined;
    case "provider":
      return theme.fg("dim", formatProvider(ctx));
    case "model":
      return theme.fg("dim", formatModel(ctx));
    case "thinking":
      return theme.fg("dim", formatThinking(pi));
    case "cost": {
      const cost = formatCost(ctx);
      return cost ? theme.fg("dim", cost) : undefined;
    }
    case "context":
      return formatContextUsage(ctx, theme) ?? undefined;
    default:
      return undefined;
  }
}

function renderSide(
  blockIds: string[],
  separator: string,
  theme: ExtensionContext["ui"]["theme"],
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  gitBranch: string | null,
  gitStats: GitStats | null,
  statuses: Map<string, string | undefined>,
  commsActive: boolean,
): string {
  const parts: string[] = [];

  for (const rawBlockId of blockIds) {
    if (!KNOWN_BLOCKS.has(rawBlockId as FooterBlockId)) continue;

    const text = renderBlock({
      blockId: rawBlockId as FooterBlockId,
      theme,
      ctx,
      pi,
      gitBranch,
      gitStats,
      statuses,
      commsActive,
    });

    if (text) {
      parts.push(text);
    }
  }

  return parts.join(theme.fg("dim", separator));
}

function renderFooterLine(width: number, left: string, right: string): string {
  const gap = " ".repeat(
    Math.max(MIN_GAP, width - visibleWidth(left) - visibleWidth(right)),
  );
  return truncateToWidth(`${left}${gap}${right}`, width);
}

function ensureConfigFile(pathname: string): void {
  mkdirSync(path.dirname(pathname), { recursive: true });
  if (!existsSync(pathname)) {
    writeFileSync(pathname, defaultConfigText(), "utf8");
  }
}

function openConfigInEditor(pathname: string): {
  ok: boolean;
  message: string;
} {
  const editorCommand = process.env.VISUAL || process.env.EDITOR;
  if (!editorCommand) {
    return {
      ok: false,
      message: `Set $VISUAL or $EDITOR. Config path: ${pathname}`,
    };
  }

  const [editor, ...editorArgs] = editorCommand.split(" ");
  if (!editor) {
    return {
      ok: false,
      message: `Invalid editor command. Config path: ${pathname}`,
    };
  }

  const result = spawnSync(editor, [...editorArgs, pathname], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status && result.status !== 0) {
    return {
      ok: false,
      message: `Editor exited with code ${result.status}`,
    };
  }

  return { ok: true, message: `Updated ${pathname}` };
}

export default function runtimeFooterExtension(pi: ExtensionAPI) {
  let commsActive = false;
  let gitStatsCache: GitStatsCache | undefined;
  let configCache: FooterConfigCache | undefined;
  let lastConfigError: string | undefined;

  pi.events.on("agent-channel:comms", (active: unknown) => {
    commsActive = active === true;
  });

  pi.registerCommand(COMMAND_NAME, {
    description:
      "Open runtime footer config in $EDITOR. Usage: /runtime-footer-config [global|local] (default: global)",
    getArgumentCompletions: (prefix) => {
      const options = [
        {
          label: "global",
          value: "global",
          description: "edit ~/.pi/agent/runtime-footer.json",
        },
        {
          label: "local",
          value: "local",
          description: "edit .pi/runtime-footer.json in current repo",
        },
      ];

      const normalized = prefix.trim().toLowerCase();
      const filtered = options.filter((option) =>
        option.value.startsWith(normalized),
      );

      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const modeRaw = args.trim();
      const mode =
        modeRaw === "" ? "global" : modeRaw === "project" ? "local" : modeRaw;
      if (mode !== "global" && mode !== "local") {
        ctx.ui.notify(
          "Usage: /runtime-footer-config [global|local]",
          "warning",
        );
        return;
      }

      const targetPath =
        mode === "local" ? projectConfigPath(ctx.cwd) : GLOBAL_CONFIG_PATH;
      ensureConfigFile(targetPath);

      const opened = openConfigInEditor(targetPath);
      ctx.ui.notify(opened.message, opened.ok ? "success" : "warning");

      configCache = undefined;
      lastConfigError = undefined;
      pi.events.emit(CONFIG_CHANGED_EVENT, undefined);
    },
  });

  const installFooter = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;

    ctx.ui.setFooter((tui, theme, footerData) => {
      const disposeBranch = footerData.onBranchChange(() =>
        tui.requestRender(),
      );
      const disposeBranchStatus = pi.events.on("branch-status:changed", () =>
        tui.requestRender(),
      );
      const disposeComms = pi.events.on("agent-channel:comms", () =>
        tui.requestRender(),
      );
      const disposeConfig = pi.events.on(CONFIG_CHANGED_EVENT, () =>
        tui.requestRender(),
      );

      return {
        dispose() {
          disposeBranch();
          disposeBranchStatus();
          disposeComms();
          disposeConfig();
        },
        invalidate() {},
        render(width: number): string[] {
          configCache = readFooterConfig(ctx.cwd, configCache);
          if (configCache.error && configCache.error !== lastConfigError) {
            lastConfigError = configCache.error;
            ctx.ui.notify(
              `runtime-footer config error (${configCache.error}); using defaults`,
              "warning",
            );
          } else if (!configCache.error) {
            lastConfigError = undefined;
          }

          const usesGit =
            configCache.config.left.includes("git") ||
            configCache.config.right.includes("git");
          if (usesGit) {
            gitStatsCache = getGitStats(gitStatsCache);
          }

          const statuses = footerData.getExtensionStatuses();
          const gitBranch = footerData.getGitBranch();
          const gitStats = usesGit ? (gitStatsCache?.stats ?? null) : null;

          const left = renderSide(
            configCache.config.left,
            configCache.config.separator,
            theme,
            ctx,
            pi,
            gitBranch,
            gitStats,
            statuses,
            commsActive,
          );
          const right = renderSide(
            configCache.config.right,
            configCache.config.separator,
            theme,
            ctx,
            pi,
            gitBranch,
            gitStats,
            statuses,
            commsActive,
          );

          const lines = [renderFooterLine(width, left, right)];

          if (configCache.config.branchStatusLine) {
            const branchStatus = statuses.get("branch-status");
            if (branchStatus) {
              lines.push(truncateToWidth(branchStatus, width));
            }
          }

          return lines;
        },
      };
    });
  };

  pi.on("session_start", async (_event, ctx) => installFooter(ctx));
  pi.on("session_tree", async (_event, ctx) => installFooter(ctx));
}
