import { type ExtensionAPI, type Theme } from "@mariozechner/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

type ModelLike = {
  id: string;
  provider: string;
};

type UsageWindow = {
  used_percent: number;
  limit_window_seconds: number;
  reset_after_seconds: number;
  reset_at: number;
};

type UsageRateLimit = {
  allowed: boolean;
  limit_reached: boolean;
  primary_window: UsageWindow | null;
  secondary_window: UsageWindow | null;
};

type UsageCredits = {
  has_credits: boolean;
  unlimited: boolean;
  balance: string;
  approx_local_messages: [number, number];
  approx_cloud_messages: [number, number];
};

type ChatGptWhamUsageResponse = {
  user_id: string;
  account_id: string;
  email: string;
  plan_type: string;
  rate_limit: UsageRateLimit | null;
  code_review_rate_limit: UsageRateLimit | null;
  additional_rate_limits: unknown;
  credits: UsageCredits | null;
  promo: unknown;
};

type OpenRouterKeyData = {
  label: string | null;
  is_management_key: boolean;
  is_provisioning_key: boolean;
  limit: number | null;
  limit_reset: string | null;
  limit_remaining: number | null;
  include_byok_in_limit: boolean;
  usage: number | null;
  usage_daily: number | null;
  usage_weekly: number | null;
  usage_monthly: number | null;
  byok_usage: number | null;
  byok_usage_daily: number | null;
  byok_usage_weekly: number | null;
  byok_usage_monthly: number | null;
  is_free_tier: boolean;
  expires_at: string | null;
  creator_user_id: string | null;
  rate_limit: {
    requests: number;
    interval: string;
    note?: string;
  } | null;
};

type OpenRouterKeyResponse = {
  data: OpenRouterKeyData;
};

type UsageCardTone = "success" | "warning" | "error" | "muted" | "accent";

type UsageCard = {
  title: string;
  value: string;
  subtitle?: string;
  progress?: {
    usedPercent: number;
    displayMode?: "remaining" | "used";
  };
  tone?: UsageCardTone;
};

type BackendSnapshot = {
  backendKey: string;
  backendName: string;
  accountLabel?: string;
  planLabel?: string;
  accessLabel?: string;
  accessTone?: UsageCardTone;
  cards: UsageCard[];
  notes: string[];
  fetchedAt: number;
};

type UsageBackend = {
  key: string;
  name: string;
  matchesModel(model: ModelLike | undefined): boolean;
  fetch(signal?: AbortSignal): Promise<BackendSnapshot>;
};

type ComponentState =
  | { kind: "loading"; message: string }
  | { kind: "ready"; snapshots: BackendSnapshot[] }
  | { kind: "error"; message: string };

const COMMAND_NAME = "usage";
const HOME_DIR = process.env.HOME || os.homedir();
const AUTH_PATH = path.join(HOME_DIR, ".codex", "auth.json");
const PI_AUTH_PATH = path.join(HOME_DIR, ".pi", "agent", "auth.json");
const CHATGPT_BACKEND_KEY = "chatgpt-wham";
const CHATGPT_BACKEND_NAME = "ChatGPT subscription";
const CHATGPT_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const OPENROUTER_BACKEND_KEY = "openrouter-key";
const OPENROUTER_BACKEND_NAME = "OpenRouter credits";
const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key";
const OPENROUTER_CREDITS_URL = "https://openrouter.ai/api/v1/credits";
const INTERACTIVE_MODE_ERROR = `/${COMMAND_NAME} requires interactive mode`;
const TITLE_TEXT = "Usage";
const REFRESH_KEY = "r";
const CLOSE_KEY = "q";
const BG_WHITE = "\u001b[48;2;255;255;255m";
const BG_RESET = "\u001b[49m";
const COLOR_ACCENT = "accent" as const;
const COLOR_TEXT = "text" as const;
const COLOR_DIM = "dim" as const;
const COLOR_MUTED = "muted" as const;
const COLOR_ERROR = "error" as const;
const COLOR_SUCCESS = "success" as const;
const COLOR_WARNING = "warning" as const;
const COLOR_BORDER_MUTED = "borderMuted" as const;
const METER_FILLED_CHAR = "▒";
const METER_EMPTY_CHAR = "░";
const OVERLAY_MIN_WIDTH = 88;
const OVERLAY_MARGIN = 1;
const OVERLAY_MAX_HEIGHT = "88%";
const CARD_GAP = 1;
const MIN_TWO_COLUMN_WIDTH = 88;

function formatModel(model: ModelLike | undefined): string {
  if (!model) return "none";
  return `${model.provider}/${model.id}`;
}

function formatPlan(planType: string | undefined): string | undefined {
  if (!planType) return undefined;
  return planType
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatRemainingPercent(usedPercent: number): string {
  return `${Math.max(0, 100 - clampPercent(usedPercent))}% remaining`;
}

function formatDateTime(epochSeconds: number): string {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return "unknown";

  return new Date(epochSeconds * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds}s`;

  const units: Array<[string, number]> = [
    ["d", 60 * 60 * 24],
    ["h", 60 * 60],
    ["m", 60],
  ];

  const parts: string[] = [];
  let remaining = seconds;
  for (const [label, unitSeconds] of units) {
    if (remaining >= unitSeconds) {
      parts.push(`${Math.floor(remaining / unitSeconds)}${label}`);
      remaining %= unitSeconds;
    }
    if (parts.length === 2) break;
  }

  if (parts.length === 0) {
    return `${remaining}s`;
  }

  return parts.join(" ");
}

function formatReset(window: UsageWindow | null): string {
  if (!window) return "No reset information";
  return `Resets ${formatDateTime(window.reset_at)} · in ${formatDuration(window.reset_after_seconds)}`;
}

function toneForWindow(window: UsageWindow | null): UsageCardTone {
  if (!window) return "muted";
  const used = clampPercent(window.used_percent);
  if (used >= 90) return "error";
  if (used >= 75) return "warning";
  return "success";
}

function wrapLines(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const wrapped = wrapTextWithAnsi(
      line.length > 0 ? line : " ",
      Math.max(1, width),
    );
    if (wrapped.length === 0) lines.push("");
    else lines.push(...wrapped);
  }
  return lines;
}

function withWhiteBackground(text: string): string {
  return `${BG_WHITE}${text}${BG_RESET}`;
}

function colorize(theme: Theme, tone: UsageCardTone, text: string): string {
  switch (tone) {
    case "accent":
      return theme.fg(COLOR_ACCENT, text);
    case "success":
      return theme.fg(COLOR_SUCCESS, text);
    case "warning":
      return theme.fg(COLOR_WARNING, text);
    case "error":
      return theme.fg(COLOR_ERROR, text);
    default:
      return theme.fg(COLOR_MUTED, text);
  }
}

function padRight(text: string, width: number): string {
  const truncated = truncateToWidth(text, width);
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

function joinColumns(left: string, right: string, width: number): string {
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
  return truncateToWidth(`${left}${" ".repeat(gap)}${right}`, width);
}

function drawMeter(
  theme: Theme,
  width: number,
  usedPercent: number,
  tone: UsageCardTone,
  displayMode: "remaining" | "used" = "used",
): string {
  const innerWidth = Math.max(8, width - 2);
  const clampedUsed = clampPercent(usedPercent);
  const highlightedPercent =
    displayMode === "remaining" ? Math.max(0, 100 - clampedUsed) : clampedUsed;
  const highlightedCount = Math.round((highlightedPercent / 100) * innerWidth);
  const mutedCount = Math.max(0, innerWidth - highlightedCount);
  const highlighted = colorize(
    theme,
    tone,
    METER_FILLED_CHAR.repeat(highlightedCount),
  );
  const muted = theme.fg(COLOR_DIM, METER_EMPTY_CHAR.repeat(mutedCount));

  return truncateToWidth(`${highlighted}${muted}`, width);
}

function boxLines(
  theme: Theme,
  width: number,
  title: string,
  bodyLines: string[],
  options?: { accent?: boolean },
): string[] {
  const accent = options?.accent ?? false;
  const borderTone = accent ? COLOR_ACCENT : COLOR_BORDER_MUTED;
  const horizontal = theme.fg(borderTone, "─".repeat(Math.max(0, width - 2)));
  const top =
    theme.fg(borderTone, "┌") + horizontal + theme.fg(borderTone, "┐");
  const bottom =
    theme.fg(borderTone, "└") + horizontal + theme.fg(borderTone, "┘");
  const titleLine = padRight(
    `${accent ? theme.fg(COLOR_ACCENT, theme.bold(title)) : theme.bold(title)}`,
    Math.max(1, width - 4),
  );

  const lines = [top];
  lines.push(
    `${theme.fg(borderTone, "│")} ${titleLine} ${theme.fg(borderTone, "│")}`,
  );

  for (const line of bodyLines) {
    const wrapped = wrapLines(line, Math.max(1, width - 4));
    for (const wrappedLine of wrapped) {
      lines.push(
        `${theme.fg(borderTone, "│")} ${padRight(wrappedLine, width - 4)} ${theme.fg(borderTone, "│")}`,
      );
    }
  }

  lines.push(bottom);
  return lines.map((line) => withWhiteBackground(padRight(line, width)));
}

function hJoinBlocks(left: string[], right: string[], gap: number): string[] {
  const height = Math.max(left.length, right.length);
  const leftWidth = left.reduce(
    (max, line) => Math.max(max, visibleWidth(line)),
    0,
  );
  const lines: string[] = [];

  for (let i = 0; i < height; i += 1) {
    const leftLine = left[i] ?? "";
    const rightLine = right[i] ?? "";
    lines.push(
      `${padRight(leftLine, leftWidth)}${" ".repeat(gap)}${rightLine}`,
    );
  }

  return lines;
}

function formatCurrency(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) return "unknown";
  return `$${Number(value).toFixed(2)}`;
}

function normalizeChatGptSnapshot(
  response: ChatGptWhamUsageResponse,
): BackendSnapshot {
  const cards: UsageCard[] = [];

  if (response.rate_limit?.primary_window) {
    cards.push({
      title: "5 hour usage limit",
      value: formatRemainingPercent(
        response.rate_limit.primary_window.used_percent,
      ),
      subtitle: formatReset(response.rate_limit.primary_window),
      progress: {
        usedPercent: response.rate_limit.primary_window.used_percent,
        displayMode: "remaining",
      },
      tone: toneForWindow(response.rate_limit.primary_window),
    });
  }

  if (response.rate_limit?.secondary_window) {
    cards.push({
      title: "Weekly usage limit",
      value: formatRemainingPercent(
        response.rate_limit.secondary_window.used_percent,
      ),
      subtitle: formatReset(response.rate_limit.secondary_window),
      progress: {
        usedPercent: response.rate_limit.secondary_window.used_percent,
        displayMode: "remaining",
      },
      tone: toneForWindow(response.rate_limit.secondary_window),
    });
  }

  if (response.credits) {
    const balance = response.credits.unlimited
      ? "Unlimited"
      : response.credits.balance;
    cards.push({
      title: "Credits remaining",
      value: balance,
      subtitle: response.credits.has_credits
        ? "Credits can be used beyond your plan limit"
        : "No add-on credits available",
      tone: response.credits.unlimited
        ? "success"
        : response.credits.has_credits && Number(response.credits.balance) > 0
          ? "accent"
          : "muted",
    });
  }

  return {
    backendKey: CHATGPT_BACKEND_KEY,
    backendName: CHATGPT_BACKEND_NAME,
    accountLabel: response.email,
    planLabel: formatPlan(response.plan_type),
    accessLabel:
      response.rate_limit?.allowed === false
        ? "Usage: unavailable"
        : "Usage: available",
    accessTone:
      response.rate_limit?.allowed === false ? COLOR_ERROR : COLOR_SUCCESS,
    cards,
    notes: [],
    fetchedAt: Date.now(),
  };
}

function maskOpenRouterLabel(
  label: string | null | undefined,
): string | undefined {
  if (!label) return undefined;
  const trimmed = label.trim();
  if (trimmed.length <= 10) return "OpenRouter key";
  return `${trimmed.slice(0, 7)}…${trimmed.slice(-4)}`;
}

function parseOpenRouterAuthEntryKey(auth: unknown): string | null {
  if (!auth || typeof auth !== "object") return null;
  const openrouter = (auth as Record<string, unknown>).openrouter;
  if (!openrouter || typeof openrouter !== "object") return null;
  const key = (openrouter as Record<string, unknown>).key;
  if (typeof key !== "string" || key.length === 0) return null;

  if (key.startsWith("!")) {
    throw new Error(
      "OpenRouter auth uses command-based key resolution; set OPENROUTER_API_KEY in env for /usage",
    );
  }

  const envValue = process.env[key];
  if (envValue) return envValue;
  return key;
}

async function readCodexAccessToken(): Promise<string> {
  const authRaw = await fs.readFile(AUTH_PATH, "utf8");
  const auth = JSON.parse(authRaw) as {
    tokens?: { access_token?: string };
  };
  const token = auth.tokens?.access_token;
  if (!token) {
    throw new Error(`Missing tokens.access_token in ${AUTH_PATH}`);
  }
  return token;
}

async function readOpenRouterToken(): Promise<string> {
  const envToken =
    process.env.OPENROUTER_MANAGEMENT_KEY || process.env.OPENROUTER_API_KEY;
  if (envToken) return envToken;

  try {
    const authRaw = await fs.readFile(PI_AUTH_PATH, "utf8");
    const auth = JSON.parse(authRaw);
    const token = parseOpenRouterAuthEntryKey(auth);
    if (token) return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
  }

  throw new Error(
    "Missing OpenRouter credentials (OPENROUTER_API_KEY env or ~/.pi/agent/auth.json openrouter entry)",
  );
}

function tryExtractOpenRouterCreditsAmount(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;

  const readNumber = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };

  const root = payload as Record<string, unknown>;
  const data =
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>)
      : null;

  const tryRemainingFrom = (
    obj: Record<string, unknown> | null,
  ): number | null => {
    if (!obj) return null;
    const total =
      readNumber(obj.total_credits) ??
      readNumber(obj.totalCredits) ??
      readNumber(obj.total);
    const usage =
      readNumber(obj.total_usage) ??
      readNumber(obj.usage) ??
      readNumber(obj.used) ??
      readNumber(obj.spent);

    if (total !== null && usage !== null) {
      return Math.max(0, total - usage);
    }

    return null;
  };

  // Prefer explicit "remaining" style fields first.
  const explicitCandidates = [
    data?.remaining_credits,
    data?.available_credits,
    root.remaining_credits,
    root.available_credits,
  ];

  for (const candidate of explicitCandidates) {
    const parsed = readNumber(candidate);
    if (parsed !== null) return parsed;
  }

  const computedFromData = tryRemainingFrom(data);
  if (computedFromData !== null) return computedFromData;

  const computedFromRoot = tryRemainingFrom(root);
  if (computedFromRoot !== null) return computedFromRoot;

  return null;
}

function normalizeOpenRouterSnapshot(
  response: OpenRouterKeyResponse,
  accountCredits: number | null,
  extraNotes: string[] = [],
): BackendSnapshot {
  const keyData = response.data;

  const cards: UsageCard[] = [
    {
      title: "Credits remaining",
      value:
        accountCredits === null ? "Unknown" : formatCurrency(accountCredits),
      subtitle:
        accountCredits === null
          ? "Account wallet balance not exposed to this key/API"
          : "Account wallet balance",
      tone: accountCredits === null ? "muted" : "success",
    },
    {
      title: "Spent today",
      value: formatCurrency(keyData.usage_daily),
      subtitle: "Daily spend from OpenRouter /key",
      tone: "muted",
    },
  ];

  const notes: string[] = [];
  if (keyData.expires_at) {
    notes.push(`Key expires at ${keyData.expires_at}`);
  }

  notes.push(...extraNotes);

  return {
    backendKey: OPENROUTER_BACKEND_KEY,
    backendName: OPENROUTER_BACKEND_NAME,
    accountLabel: maskOpenRouterLabel(keyData.label),
    planLabel: keyData.is_free_tier ? "Free tier" : "API key",
    accessLabel: "Usage: available via /key",
    accessTone: COLOR_SUCCESS,
    cards,
    notes,
    fetchedAt: Date.now(),
  };
}

const chatGptBackend: UsageBackend = {
  key: CHATGPT_BACKEND_KEY,
  name: CHATGPT_BACKEND_NAME,
  matchesModel(model) {
    if (!model) return false;
    const provider = model.provider.toLowerCase();
    const id = model.id.toLowerCase();
    return (
      provider === "openai" ||
      provider === "chatgpt" ||
      /^gpt-/.test(id) ||
      /^o[1-9]/.test(id) ||
      id.startsWith("codex")
    );
  },
  async fetch(signal) {
    const token = await readCodexAccessToken();
    const response = await fetch(CHATGPT_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `Usage request failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as ChatGptWhamUsageResponse;
    return normalizeChatGptSnapshot(data);
  },
};

const openRouterBackend: UsageBackend = {
  key: OPENROUTER_BACKEND_KEY,
  name: OPENROUTER_BACKEND_NAME,
  matchesModel(model) {
    if (!model) return false;
    const provider = model.provider.toLowerCase();
    const id = model.id.toLowerCase();
    return provider === "openrouter" || id.startsWith("openrouter/");
  },
  async fetch(signal) {
    try {
      const token = await readOpenRouterToken();
      const response = await fetch(OPENROUTER_KEY_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        signal,
      });

      if (!response.ok) {
        throw new Error(
          `OpenRouter request failed: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as OpenRouterKeyResponse;

      let accountCredits: number | null = null;
      const extraNotes: string[] = [];
      try {
        const creditsResponse = await fetch(OPENROUTER_CREDITS_URL, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          signal,
        });

        if (creditsResponse.ok) {
          const creditsData = (await creditsResponse.json()) as unknown;
          accountCredits = tryExtractOpenRouterCreditsAmount(creditsData);
          if (accountCredits === null) {
            extraNotes.push(
              "Account credits endpoint returned an unrecognized schema.",
            );
          }
        } else {
          extraNotes.push(
            `Account credits endpoint unavailable (${creditsResponse.status}).`,
          );
        }
      } catch {
        // Best-effort only; /key data still renders.
      }

      return normalizeOpenRouterSnapshot(data, accountCredits, extraNotes);
    } catch (error) {
      return {
        backendKey: OPENROUTER_BACKEND_KEY,
        backendName: OPENROUTER_BACKEND_NAME,
        planLabel: "API key",
        accessLabel: "Usage: unavailable",
        accessTone: COLOR_WARNING,
        cards: [
          {
            title: "Credits remaining",
            value: "Unavailable",
            subtitle:
              error instanceof Error
                ? error.message
                : "Unable to fetch OpenRouter /key",
            tone: "warning",
          },
          {
            title: "Auto-top-up",
            value: "Unknown",
            subtitle: "Not exposed by OpenRouter /key API response",
            tone: "muted",
          },
        ],
        notes: [],
        fetchedAt: Date.now(),
      };
    }
  },
};

const usageBackends: UsageBackend[] = [chatGptBackend, openRouterBackend];

class UsageOverlayComponent {
  private state: ComponentState = {
    kind: "loading",
    message: "Fetching usage…",
  };
  private requestRender: (full?: boolean) => void;
  private done: () => void;
  private theme: Theme;
  private model: ModelLike | undefined;
  private abortController: AbortController | null = null;

  constructor(
    theme: Theme,
    requestRender: (full?: boolean) => void,
    done: () => void,
    model: ModelLike | undefined,
  ) {
    this.theme = theme;
    this.requestRender = requestRender;
    this.done = done;
    this.model = model;
  }

  async init(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    this.state = { kind: "loading", message: "Fetching usage…" };
    this.requestRender(true);

    try {
      const snapshots = await Promise.all(
        usageBackends.map((backend) => backend.fetch(controller.signal)),
      );
      if (controller.signal.aborted) return;
      this.state = {
        kind: "ready",
        snapshots,
      };
      this.requestRender(true);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.state = {
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      };
      this.requestRender(true);
    }
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, CLOSE_KEY)) {
      this.abortController?.abort();
      this.done();
      return;
    }

    if (matchesKey(data, REFRESH_KEY)) {
      void this.refresh();
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    const fullWidth = Math.max(48, width);
    const contentWidth = Math.max(40, fullWidth - 2);
    const borderFg = (text: string) => this.theme.fg(COLOR_ACCENT, text);
    const frameBg = (text: string) => withWhiteBackground(text);
    const frameLine = (content: string) =>
      frameBg(
        `${borderFg("┃")}${padRight(content, contentWidth)}${borderFg("┃")}`,
      );
    const borderLine = (
      left: string,
      fill: string,
      right: string,
      label = "",
    ) => {
      const safeLabel = truncateToWidth(label, contentWidth, "");
      const fillWidth = Math.max(0, contentWidth - visibleWidth(safeLabel));
      return frameBg(
        `${borderFg(left)}${safeLabel}${borderFg(fill.repeat(fillWidth))}${borderFg(right)}`,
      );
    };

    const body: string[] = [];
    let footerRight = "";

    if (this.state.kind === "loading") {
      body.push(this.theme.fg(COLOR_MUTED, this.state.message));
    } else if (this.state.kind === "error") {
      body.push(this.theme.fg(COLOR_ERROR, this.state.message));
      body.push(this.theme.fg(COLOR_DIM, `Auth source: ${AUTH_PATH}`));
    } else {
      const latestFetchedAt = this.state.snapshots.reduce(
        (max, snapshot) => Math.max(max, snapshot.fetchedAt),
        0,
      );
      if (latestFetchedAt > 0) {
        footerRight = this.theme.fg(
          COLOR_DIM,
          `Fetched ${new Date(latestFetchedAt).toLocaleTimeString()}`,
        );
      }

      for (const [index, snapshot] of this.state.snapshots.entries()) {
        const isCurrent = usageBackends.some(
          (backend) =>
            backend.key === snapshot.backendKey &&
            backend.matchesModel(this.model),
        );
        const headingLeft = isCurrent
          ? this.theme.fg(
              COLOR_ACCENT,
              this.theme.bold(`${snapshot.backendName} · current`),
            )
          : this.theme.bold(snapshot.backendName);
        const accessIcon = snapshot.accessLabel
          ? /unavailable/i.test(snapshot.accessLabel)
            ? colorize(this.theme, "error", this.theme.bold(" ✗ "))
            : /available/i.test(snapshot.accessLabel)
              ? colorize(this.theme, "success", this.theme.bold(" ✓ "))
              : colorize(
                  this.theme,
                  snapshot.accessTone ?? COLOR_MUTED,
                  this.theme.bold(" • "),
                )
          : "";
        const heading = accessIcon
          ? `${padRight(headingLeft, Math.max(1, contentWidth - 3))}${accessIcon}`
          : headingLeft;

        const metaLeft = snapshot.planLabel
          ? this.theme.fg(COLOR_MUTED, `Plan: ${snapshot.planLabel}`)
          : this.theme.fg(COLOR_MUTED, "Plan: unknown");
        const metaRight = snapshot.accountLabel
          ? this.theme.fg(COLOR_DIM, snapshot.accountLabel)
          : this.theme.fg(COLOR_DIM, "No account label");

        body.push(heading);
        body.push(joinColumns(metaLeft, metaRight, contentWidth));

        const cardWidth =
          contentWidth >= MIN_TWO_COLUMN_WIDTH
            ? Math.max(30, Math.floor((contentWidth - CARD_GAP) / 2))
            : contentWidth;
        const cardBlocks = snapshot.cards.map((card) => {
          const cardBody: string[] = [
            colorize(
              this.theme,
              card.tone ?? COLOR_MUTED,
              this.theme.bold(card.value),
            ),
          ];
          if (card.progress) {
            cardBody.push(
              drawMeter(
                this.theme,
                Math.max(12, cardWidth - 4),
                card.progress.usedPercent,
                card.tone ?? COLOR_MUTED,
                card.progress.displayMode,
              ),
            );
          }
          if (card.subtitle) {
            cardBody.push(this.theme.fg(COLOR_DIM, card.subtitle));
          }
          return boxLines(this.theme, cardWidth, card.title, cardBody, {
            accent: isCurrent && index === 0,
          });
        });

        if (cardWidth === contentWidth) {
          for (const block of cardBlocks) {
            body.push(...block);
          }
        } else {
          for (let i = 0; i < cardBlocks.length; i += 2) {
            const left = cardBlocks[i]!;
            const right = cardBlocks[i + 1];
            body.push(...(right ? hJoinBlocks(left, right, CARD_GAP) : left));
          }
        }

        if (snapshot.notes.length > 0) {
          for (const note of snapshot.notes) {
            body.push(this.theme.fg(COLOR_DIM, `• ${note}`));
          }
        }

        if (index < this.state.snapshots.length - 1) {
          body.push(
            this.theme.fg(COLOR_BORDER_MUTED, "─".repeat(contentWidth)),
          );
        }
      }
    }

    const footerLeft = this.theme.fg(
      COLOR_DIM,
      `${REFRESH_KEY} refresh • ${CLOSE_KEY} close`,
    );
    body.push(
      footerRight
        ? joinColumns(footerLeft, footerRight, contentWidth)
        : footerLeft,
    );

    return [
      borderLine(
        "┏",
        "━",
        "┓",
        ` ${this.theme.bold(this.theme.fg(COLOR_ACCENT, TITLE_TEXT))} `,
      ),
      ...body.map((line) => frameLine(line)),
      borderLine("┗", "━", "┛"),
    ].map((line) => truncateToWidth(line, fullWidth));
  }
}

export default function usageExtension(pi: ExtensionAPI) {
  pi.registerCommand(COMMAND_NAME, {
    description: "Open an on-demand usage overlay for configured backends",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify(INTERACTIVE_MODE_ERROR, COLOR_ERROR);
        return;
      }

      await ctx.ui.custom(
        (tui, theme, _kb, done) => {
          const component = new UsageOverlayComponent(
            theme,
            (full) => tui.requestRender(Boolean(full)),
            () => done(undefined),
            ctx.model
              ? { id: ctx.model.id, provider: ctx.model.provider }
              : undefined,
          );
          void component.init();
          return component;
        },
        {
          overlay: true,
          overlayOptions: {
            anchor: "center",
            width: "78%",
            minWidth: OVERLAY_MIN_WIDTH,
            maxHeight: OVERLAY_MAX_HEIGHT,
            margin: OVERLAY_MARGIN,
          },
        },
      );
    },
  });
}
