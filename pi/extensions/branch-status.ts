import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

type SessionEntryLike = {
  id: string;
  parentId: string | null;
};

const STATUS_KEY = "branch-status";
const RENDER_EVENT = "branch-status:changed";
const MAX_LABEL_LENGTH = 24;

function truncateLabel(label: string): string {
  const normalized = label.trim().replace(/\s+/g, " ");
  if (normalized.length <= MAX_LABEL_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_LABEL_LENGTH - 1)}…`;
}

function hasBranches(entries: SessionEntryLike[]): boolean {
  const childCounts = new Map<string, number>();

  for (const entry of entries) {
    if (!entry.parentId) continue;
    const count = (childCounts.get(entry.parentId) ?? 0) + 1;
    if (count > 1) return true;
    childCounts.set(entry.parentId, count);
  }

  return false;
}

function labelsOnCurrentPath(
  ctx: ExtensionContext,
  entries: SessionEntryLike[],
): string[] {
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const labels: string[] = [];
  let entry = ctx.sessionManager.getLeafEntry() as SessionEntryLike | undefined;

  while (entry) {
    const label = ctx.sessionManager.getLabel(entry.id);
    if (label) labels.push(truncateLabel(label));
    entry = entry.parentId ? entriesById.get(entry.parentId) : undefined;
  }

  return labels.reverse();
}

function renderStatus(ctx: ExtensionContext): string | undefined {
  const entries = ctx.sessionManager.getEntries() as SessionEntryLike[];
  if (!hasBranches(entries)) return undefined;

  const labels = labelsOnCurrentPath(ctx, entries);
  const path = labels.length > 0 ? ` ${labels.join(" → ")}` : "";
  return ctx.ui.theme.fg("dim", `[⋔${path}]`);
}

function updateStatus(
  ctx: ExtensionContext,
  lastRendered?: string,
): string | undefined {
  if (!ctx.hasUI) return lastRendered;
  const rendered = renderStatus(ctx);
  if (rendered !== lastRendered) {
    ctx.ui.setStatus(STATUS_KEY, rendered);
  }
  return rendered;
}

export default function branchStatusExtension(pi: ExtensionAPI) {
  let lastCtx: ExtensionContext | undefined;
  let lastRendered: string | undefined;

  const refresh = (ctx: ExtensionContext) => {
    lastCtx = ctx;
    const nextRendered = updateStatus(ctx, lastRendered);
    if (nextRendered !== lastRendered) {
      pi.events.emit(RENDER_EVENT, undefined);
    }
    lastRendered = nextRendered;
  };

  pi.events.on("bookmark:changed", () => {
    if (lastCtx) {
      lastRendered = undefined;
      refresh(lastCtx);
    }
  });

  pi.on("session_start", async (_event, ctx) => refresh(ctx));
  pi.on("session_tree", async (_event, ctx) => refresh(ctx));
  pi.on("turn_end", async (_event, ctx) => refresh(ctx));
}
