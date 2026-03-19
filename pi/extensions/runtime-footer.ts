import type { AssistantMessage } from "@mariozechner/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

const MIN_GAP = 2;

function formatCwd(): string {
  const cwd = process.cwd();
  const home = process.env.HOME;
  if (home && cwd.startsWith(home)) {
    return `~${cwd.slice(home.length)}` || "~";
  }
  return cwd;
}

function formatModel(ctx: ExtensionContext): string {
  return ctx.model?.id ?? "no-model";
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

  if (!usage || !contextWindow || contextWindow <= 0) {
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

function renderLeft(
  theme: ExtensionContext["ui"]["theme"],
  gitBranch: string | null,
): string {
  const parts: string[] = [formatCwd()];

  if (gitBranch) {
    parts.push(gitBranch);
  }

  return theme.fg("dim", parts.join(" · "));
}

function renderRight(
  ctx: ExtensionContext,
  theme: ExtensionContext["ui"]["theme"],
): string {
  const dimParts: string[] = [formatModel(ctx)];
  const cost = formatCost(ctx);
  const context = formatContextUsage(ctx, theme);

  if (cost) {
    dimParts.push(cost);
  }

  const left = theme.fg("dim", dimParts.join(" · "));
  if (!context) {
    return left;
  }

  return `${left}${theme.fg("dim", " · ")}${context}`;
}

function renderFooterLine(width: number, left: string, right: string): string {
  const gap = " ".repeat(
    Math.max(MIN_GAP, width - visibleWidth(left) - visibleWidth(right)),
  );
  return truncateToWidth(`${left}${gap}${right}`, width);
}

export default function runtimeFooterExtension(pi: ExtensionAPI) {
  const installFooter = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;

    ctx.ui.setFooter((tui, theme, footerData) => {
      const disposeBranch = footerData.onBranchChange(() =>
        tui.requestRender(),
      );
      const disposeBranchStatus = pi.events.on("branch-status:changed", () =>
        tui.requestRender(),
      );

      return {
        dispose() {
          disposeBranch();
          disposeBranchStatus();
        },
        invalidate() {},
        render(width: number): string[] {
          const statuses = footerData.getExtensionStatuses();
          const left = renderLeft(theme, footerData.getGitBranch());
          const right = renderRight(ctx, theme);
          const lines = [renderFooterLine(width, left, right)];
          const branchStatus = statuses.get("branch-status");

          if (branchStatus) {
            lines.push(truncateToWidth(branchStatus, width));
          }

          return lines;
        },
      };
    });
  };

  pi.on("session_start", async (_event, ctx) => installFooter(ctx));
  pi.on("session_switch", async (_event, ctx) => installFooter(ctx));
  pi.on("session_tree", async (_event, ctx) => installFooter(ctx));
  pi.on("session_fork", async (_event, ctx) => installFooter(ctx));
}
