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

function renderStatus(ctx: ExtensionContext): string {
  const theme = ctx.ui.theme;
  const trail = computeBranchTrail(ctx);
  if (trail.length === 0) {
    return theme.fg("dim", "main");
  }

  const [current, ...ancestors] = trail;
  const currentBadge = `\x1b[7m${theme.fg("dim", ` ${current} `)}\x1b[27m`;
  if (ancestors.length === 0) {
    return currentBadge;
  }

  return `${currentBadge}${theme.fg("dim", " -> ")}${ancestors.join(theme.fg("dim", " ->  "))}`;
}

function updateStatus(ctx: ExtensionContext, lastRendered?: string): string {
  if (!ctx.hasUI) return lastRendered ?? "";
  const rendered = renderStatus(ctx);
  if (rendered !== lastRendered) {
    ctx.ui.setStatus(STATUS_KEY, rendered);
  }
  return rendered;
}

export default function branchStatusExtension(pi: ExtensionAPI) {
  let lastCtx: ExtensionContext | undefined;
  let lastRendered = "";

  const refresh = (ctx: ExtensionContext) => {
    lastCtx = ctx;
    lastRendered = updateStatus(ctx, lastRendered);
  };

  pi.events.on("bookmark:changed", () => {
    if (lastCtx) {
      lastRendered = "";
      refresh(lastCtx);
    }
  });

  pi.on("session_start", async (_event, ctx) => refresh(ctx));
  pi.on("session_switch", async (_event, ctx) => refresh(ctx));
  pi.on("session_tree", async (_event, ctx) => refresh(ctx));
  pi.on("session_fork", async (_event, ctx) => refresh(ctx));
}
