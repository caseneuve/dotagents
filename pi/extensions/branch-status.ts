import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";

type SessionEntryLike = {
  id: string;
  parentId: string | null;
  type?: string;
};

const STATUS_KEY = "branch-status";
const RENDER_EVENT = "branch-status:changed";
const MAX_LABEL_LENGTH = 24;
const FALLBACK_ID_LENGTH = 8;

function truncateLabel(label: string): string {
  const normalized = label.trim().replace(/\s+/g, " ");
  if (normalized.length <= MAX_LABEL_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_LABEL_LENGTH - 1)}…`;
}

function buildChildCountMap(entries: SessionEntryLike[]): Map<string, number> {
  const childCounts = new Map<string, number>();

  for (const entry of entries) {
    childCounts.set(entry.id, childCounts.get(entry.id) ?? 0);
    if (entry.parentId) {
      childCounts.set(
        entry.parentId,
        (childCounts.get(entry.parentId) ?? 0) + 1,
      );
    }
  }

  return childCounts;
}

function buildEntryMap(
  entries: SessionEntryLike[],
): Map<string, SessionEntryLike> {
  return new Map(entries.map((entry) => [entry.id, entry]));
}

function buildLeafToRootPath(
  entries: SessionEntryLike[],
  leafId: string,
): SessionEntryLike[] {
  const entryMap = buildEntryMap(entries);
  const path: SessionEntryLike[] = [];
  let currentId: string | null = leafId;

  while (currentId) {
    const entry = entryMap.get(currentId);
    if (!entry) break;
    path.push(entry);
    currentId = entry.parentId;
  }

  return path;
}

function findNearestLabel(
  ctx: ExtensionContext,
  entries: SessionEntryLike[],
): string | undefined {
  for (const entry of entries) {
    const label = ctx.sessionManager.getLabel(entry.id);
    if (label) {
      return truncateLabel(label);
    }
  }
  return undefined;
}

function fallbackName(entryId: string): string {
  return entryId.slice(0, FALLBACK_ID_LENGTH);
}

function uniqueSegments(segments: string[]): string[] {
  const unique: string[] = [];
  for (const segment of segments) {
    if (unique.at(-1) !== segment) {
      unique.push(segment);
    }
  }
  return unique;
}

function computeBranchTrail(ctx: ExtensionContext): string[] {
  const leafId = ctx.sessionManager.getLeafId();
  if (!leafId) {
    return ["main"];
  }

  const entries = ctx.sessionManager.getEntries() as SessionEntryLike[];
  const path = buildLeafToRootPath(entries, leafId);
  if (path.length === 0) {
    return ["main"];
  }

  const childCounts = buildChildCountMap(entries);
  const splitIndices: number[] = [];

  for (let i = 0; i < path.length; i += 1) {
    if ((childCounts.get(path[i].id) ?? 0) > 1) {
      splitIndices.push(i);
    }
  }

  if (splitIndices.length === 0) {
    return ["main"];
  }

  const segments: string[] = [];
  let segmentStart = 0;

  for (const splitIndex of splitIndices) {
    const segmentEntries = path.slice(segmentStart, splitIndex);
    const splitEntry = path[splitIndex];
    const name =
      findNearestLabel(ctx, segmentEntries) ?? fallbackName(splitEntry.id);
    segments.push(name);
    segmentStart = splitIndex;
  }

  segments.push("main");
  return uniqueSegments(segments);
}

function countLabels(ctx: ExtensionContext): number {
  const entries = ctx.sessionManager.getEntries() as SessionEntryLike[];
  let count = 0;

  for (const entry of entries) {
    if (ctx.sessionManager.getLabel(entry.id)) {
      count += 1;
    }
  }

  return count;
}

function renderStatus(ctx: ExtensionContext): string | undefined {
  const theme = ctx.ui.theme;
  const trail = computeBranchTrail(ctx);
  const labelCount = countLabels(ctx);

  if (trail.length <= 1 && labelCount === 0) {
    return undefined;
  }

  const branchText = trail.join(" →  ");
  const suffix = labelCount > 0 ? ` (${labelCount})` : "";

  return theme.fg("dim", `[⋔ ${branchText}]${suffix}`);
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
