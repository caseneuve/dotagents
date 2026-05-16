import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const MIN_GAP = 2;
const GIT_STATS_TTL_MS = 2000;
const PROJECT_NAME_TTL_MS = 2000;
const CONFIG_CHECK_TTL_MS = 1000;

const COMMAND_NAME = "runtime-footer-config";
const CONFIG_CHANGED_EVENT = "runtime-footer:config-changed";
const PROJECT_CONFIG_RELATIVE_PATH_JSONC = ".pi/runtime-footer.jsonc";
const PROJECT_CONFIG_RELATIVE_PATH_JSON = ".pi/runtime-footer.json";
const GLOBAL_CONFIG_PATH_JSONC = path.join(
  getAgentDir(),
  "runtime-footer.jsonc",
);
const GLOBAL_CONFIG_PATH_JSON = path.join(getAgentDir(), "runtime-footer.json");

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

type ProjectNameCache = {
  cwd: string;
  checkedAt: number;
  name: string;
};

type FooterBlockId =
  | "cwd"
  | "project"
  | "git"
  | "session-notes"
  | "comms"
  | "provider"
  | "model"
  | "thinking"
  | "cost"
  | "context";

type ThinkingMode = "literal" | "blocks";

type ThinkingConfig = {
  mode: ThinkingMode;
  mapping: Record<string, string>;
};

type RuntimeFooterConfig = {
  left: string[];
  right: string[];
  separator: string;
  truncate: number | null;
  thinking: ThinkingConfig;
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
  "project",
]);

const THINKING_BLOCK_CHARS = new Set(["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]);

const DEFAULT_THINKING_MAPPING: Record<string, string> = {
  off: "▁",
  minimal: "▂",
  low: "▃",
  medium: "▅",
  high: "▇",
  xhigh: "█",
};

function defaultConfig(): RuntimeFooterConfig {
  return {
    left: [...DEFAULT_LEFT_BLOCKS],
    right: [...DEFAULT_RIGHT_BLOCKS],
    separator: " · ",
    truncate: null,
    thinking: {
      mode: "literal",
      mapping: { ...DEFAULT_THINKING_MAPPING },
    },
    branchStatusLine: true,
  };
}

function defaultConfigText(): string {
  return `{
  // Ordered block ids rendered on the left side.
  "left": ["cwd", "git", "session-notes", "comms"],

  // Ordered block ids rendered on the right side.
  "right": ["provider", "model", "thinking", "cost", "context"],

  // Separator inserted between rendered blocks.
  "separator": " · ",

  // Optional per-block truncation (visible width). Use null to disable.
  "truncate": null,

  // Thinking block formatting.
  "thinking": {
    // "literal" (default) or "blocks"
    "mode": "literal",

    // Used only in "blocks" mode; keys are thinking levels.
    "mapping": {
      "off": "▁",
      "minimal": "▂",
      "low": "▃",
      "medium": "▅",
      "high": "▇",
      "xhigh": "█"
    }
  },

  // Show branch-status extension line under the main footer.
  "branchStatusLine": true,

  // Available block ids:
  // cwd, project, git, session-notes, comms, provider, model, thinking, cost, context
}
`;
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
    truncate?: unknown;
    thinking?: unknown;
    branchStatusLine?: unknown;
  };

  const parseSide = (side: unknown, fallback: string[]): string[] => {
    if (!Array.isArray(side)) return fallback;
    return side.filter((item): item is string => typeof item === "string");
  };

  const parseThinkingConfig = (value: unknown): ThinkingConfig => {
    if (!value || typeof value !== "object") {
      return {
        mode: base.thinking.mode,
        mapping: { ...base.thinking.mapping },
      };
    }

    const thinking = value as {
      mode?: unknown;
      mapping?: unknown;
    };

    const mode: ThinkingMode =
      thinking.mode === "blocks" ? "blocks" : base.thinking.mode;

    const mapping: Record<string, string> = { ...base.thinking.mapping };
    if (thinking.mapping && typeof thinking.mapping === "object") {
      for (const [rawKey, rawValue] of Object.entries(thinking.mapping)) {
        const key = rawKey.trim().toLowerCase();
        if (!key || typeof rawValue !== "string") continue;
        const glyph = rawValue.trim();
        if (!THINKING_BLOCK_CHARS.has(glyph)) continue;
        mapping[key] = glyph;
      }
    }

    return { mode, mapping };
  };

  return {
    left: parseSide(data.left, base.left),
    right: parseSide(data.right, base.right),
    separator:
      typeof data.separator === "string" ? data.separator : base.separator,
    truncate:
      typeof data.truncate === "number" &&
      Number.isFinite(data.truncate) &&
      data.truncate >= 1
        ? Math.floor(data.truncate)
        : base.truncate,
    thinking: parseThinkingConfig(data.thinking),
    branchStatusLine:
      typeof data.branchStatusLine === "boolean"
        ? data.branchStatusLine
        : base.branchStatusLine,
  };
}

function projectConfigPathJsonc(cwd: string): string {
  return path.join(cwd, PROJECT_CONFIG_RELATIVE_PATH_JSONC);
}

function projectConfigPathJson(cwd: string): string {
  return path.join(cwd, PROJECT_CONFIG_RELATIVE_PATH_JSON);
}

function resolveLocalConfigPath(cwd: string): string {
  const jsoncPath = projectConfigPathJsonc(cwd);
  if (existsSync(jsoncPath)) return jsoncPath;

  const jsonPath = projectConfigPathJson(cwd);
  if (existsSync(jsonPath)) return jsonPath;

  return jsoncPath;
}

function resolveGlobalConfigPath(): string {
  if (existsSync(GLOBAL_CONFIG_PATH_JSONC)) return GLOBAL_CONFIG_PATH_JSONC;
  if (existsSync(GLOBAL_CONFIG_PATH_JSON)) return GLOBAL_CONFIG_PATH_JSON;
  return GLOBAL_CONFIG_PATH_JSONC;
}

function resolveConfigSourcePath(cwd: string): string | null {
  const localJsonc = projectConfigPathJsonc(cwd);
  if (existsSync(localJsonc)) return localJsonc;

  const localJson = projectConfigPathJson(cwd);
  if (existsSync(localJson)) return localJson;

  if (existsSync(GLOBAL_CONFIG_PATH_JSONC)) return GLOBAL_CONFIG_PATH_JSONC;
  if (existsSync(GLOBAL_CONFIG_PATH_JSON)) return GLOBAL_CONFIG_PATH_JSON;
  return null;
}

/**
 * Lightweight JSONC support for runtime-footer config.
 *
 * Pi currently does not expose a public JSONC parser helper for extensions,
 * so this local parser keeps scope narrow: remove comments + trailing commas,
 * then parse as JSON.
 */
function stripJsonComments(source: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inString) {
      out += ch;
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }

    out += ch;
  }

  return out;
}

/** Remove trailing commas outside string literals so JSON.parse can handle JSONC input. */
function stripTrailingCommas(source: string): string {
  let out = "";
  let inString = false;
  let escape = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];

    if (inString) {
      out += ch;
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === ",") {
      let j = i + 1;
      while (j < source.length && /\s/.test(source[j])) {
        j += 1;
      }
      const next = source[j];
      if (next === "]" || next === "}") {
        continue;
      }
    }

    out += ch;
  }

  return out;
}

function parseJsonOrJsonc(text: string): unknown {
  const noComments = stripJsonComments(text);
  const noTrailingCommas = stripTrailingCommas(noComments);
  return JSON.parse(noTrailingCommas);
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
    const raw = parseJsonOrJsonc(readFileSync(sourcePath, "utf8"));
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

function computeProjectName(): string {
  const gitRoot = runGit(["rev-parse", "--show-toplevel"])?.trim();
  const source = gitRoot && gitRoot.length > 0 ? gitRoot : process.cwd();
  const base = path.basename(source);
  return base || source;
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

function getProjectName(cache: ProjectNameCache | undefined): ProjectNameCache {
  const now = Date.now();
  const cwd = process.cwd();
  if (
    cache &&
    cache.cwd === cwd &&
    now - cache.checkedAt < PROJECT_NAME_TTL_MS
  ) {
    return cache;
  }

  return {
    cwd,
    checkedAt: now,
    name: computeProjectName(),
  };
}

/**
 * Plain-text git stats used for per-block truncation decisions.
 * Styling is applied separately in formatGitStats().
 */
function formatGitStatsPlain(stats: GitStats | null): string | null {
  if (!stats) return null;

  const fileParts = [String(stats.changedFiles)];
  if (stats.addedFiles > 0) {
    fileParts.push(`A${stats.addedFiles}`);
  }
  if (stats.untrackedFiles > 0) {
    fileParts.push(`?${stats.untrackedFiles}`);
  }

  return `[+${stats.addedLines}/-${stats.removedLines} (${fileParts.join(", ")})]`;
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

type ContextUsageInfo = {
  text: string;
  tone: "dim" | "warning" | "error";
};

function getContextUsageInfo(ctx: ExtensionContext): ContextUsageInfo | null {
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
    return { text, tone: "error" };
  }
  if (percent >= 80) {
    return { text, tone: "warning" };
  }
  return { text, tone: "dim" };
}

type RenderBlockParams = {
  blockId: FooterBlockId;
  theme: ExtensionContext["ui"]["theme"];
  ctx: ExtensionContext;
  pi: ExtensionAPI;
  config: RuntimeFooterConfig;
  gitBranch: string | null;
  gitStats: GitStats | null;
  projectName: string;
  statuses: Map<string, string | undefined>;
  commsActive: boolean;
};

type FooterBlockText = {
  plain: string;
  styled: string;
  tone: "dim" | "accent" | "warning" | "error";
};

function renderBlock(params: RenderBlockParams): FooterBlockText | undefined {
  const {
    blockId,
    theme,
    ctx,
    pi,
    config,
    gitBranch,
    gitStats,
    projectName,
    statuses,
    commsActive,
  } = params;

  switch (blockId) {
    case "cwd": {
      const plain = formatCwd();
      return { plain, styled: theme.fg("dim", plain), tone: "dim" };
    }
    case "project": {
      const plain = projectName;
      return { plain, styled: theme.fg("dim", plain), tone: "dim" };
    }
    case "git": {
      if (!gitBranch) return undefined;
      const statsPlain = formatGitStatsPlain(gitStats);
      const statsStyled = formatGitStats(theme, gitStats);
      const plain = statsPlain ? `${gitBranch} ${statsPlain}` : gitBranch;
      const branch = theme.fg("dim", gitBranch);
      const styled = statsStyled ? `${branch} ${statsStyled}` : branch;
      return { plain, styled, tone: "dim" };
    }
    case "session-notes": {
      const status = statuses.get("session-notes");
      if (!status) return undefined;
      return { plain: status, styled: theme.fg("dim", status), tone: "dim" };
    }
    case "comms": {
      if (!commsActive) return undefined;
      return { plain: "📡", styled: theme.fg("accent", "📡"), tone: "accent" };
    }
    case "provider": {
      const plain = formatProvider(ctx);
      return { plain, styled: theme.fg("dim", plain), tone: "dim" };
    }
    case "model": {
      const plain = formatModel(ctx);
      return { plain, styled: theme.fg("dim", plain), tone: "dim" };
    }
    case "thinking": {
      const level = formatThinking(pi);
      if (config.thinking.mode === "blocks") {
        const glyph =
          config.thinking.mapping[level.toLowerCase()] ??
          config.thinking.mapping[level] ??
          "▁";
        return { plain: glyph, styled: theme.fg("dim", glyph), tone: "dim" };
      }
      return { plain: level, styled: theme.fg("dim", level), tone: "dim" };
    }
    case "cost": {
      const plain = formatCost(ctx);
      return plain
        ? { plain, styled: theme.fg("dim", plain), tone: "dim" }
        : undefined;
    }
    case "context": {
      const info = getContextUsageInfo(ctx);
      return info
        ? {
            plain: info.text,
            styled: theme.fg(info.tone, info.text),
            tone: info.tone,
          }
        : undefined;
    }
    default:
      return undefined;
  }
}

function renderSide(
  blockIds: string[],
  separator: string,
  truncate: number | null,
  theme: ExtensionContext["ui"]["theme"],
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  config: RuntimeFooterConfig,
  gitBranch: string | null,
  gitStats: GitStats | null,
  projectName: string,
  statuses: Map<string, string | undefined>,
  commsActive: boolean,
): string {
  const parts: string[] = [];

  for (const rawBlockId of blockIds) {
    if (!KNOWN_BLOCKS.has(rawBlockId as FooterBlockId)) continue;

    const block = renderBlock({
      blockId: rawBlockId as FooterBlockId,
      theme,
      ctx,
      pi,
      config,
      gitBranch,
      gitStats,
      projectName,
      statuses,
      commsActive,
    });

    if (block) {
      if (truncate && visibleWidth(block.plain) > truncate) {
        const shortened = clipPlainTextToWidth(block.plain, truncate);
        parts.push(theme.fg(block.tone, `${shortened}… `));
      } else {
        parts.push(block.styled);
      }
    }
  }

  return parts.join(theme.fg("dim", separator));
}

function clipPlainTextToWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";

  let out = "";
  let width = 0;

  for (const ch of text) {
    const chWidth = visibleWidth(ch);
    if (width + chWidth > maxWidth) break;
    out += ch;
    width += chWidth;
  }

  return out;
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
  let projectNameCache: ProjectNameCache | undefined;
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
          description: "edit ~/.pi/agent/runtime-footer.jsonc",
        },
        {
          label: "local",
          value: "local",
          description: "edit .pi/runtime-footer.jsonc in current repo",
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
        mode === "local"
          ? resolveLocalConfigPath(ctx.cwd)
          : resolveGlobalConfigPath();
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

          const usesProject =
            configCache.config.left.includes("project") ||
            configCache.config.right.includes("project");
          if (usesProject) {
            projectNameCache = getProjectName(projectNameCache);
          }

          const statuses = footerData.getExtensionStatuses();
          const gitBranch = footerData.getGitBranch();
          const gitStats = usesGit ? (gitStatsCache?.stats ?? null) : null;
          const projectName = usesProject
            ? (projectNameCache?.name ?? computeProjectName())
            : "";

          const left = renderSide(
            configCache.config.left,
            configCache.config.separator,
            configCache.config.truncate,
            theme,
            ctx,
            pi,
            configCache.config,
            gitBranch,
            gitStats,
            projectName,
            statuses,
            commsActive,
          );
          const right = renderSide(
            configCache.config.right,
            configCache.config.separator,
            configCache.config.truncate,
            theme,
            ctx,
            pi,
            configCache.config,
            gitBranch,
            gitStats,
            projectName,
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
