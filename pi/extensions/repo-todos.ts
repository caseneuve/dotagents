import { type ExtensionAPI, type Theme } from "@mariozechner/pi-coding-agent";
import {
  Input,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

type SortMode = "number" | "state" | "priority" | "type";
type FocusPane = "list" | "preview";
type QueryFocus = "none" | "input";
type SplitMode = "horizontal" | "vertical";

type TodoFrontmatter = {
  title: string;
  status: string;
  priority: string;
  type: string;
  labels: string[];
  created: string;
  parent: string | null;
  blockedBy: string[];
  blocks: string[];
};

type TodoRecord = {
  id: string;
  slug: string;
  path: string;
  filename: string;
  frontmatter: TodoFrontmatter;
  body: string;
  sections: Map<string, string>;
  children: TodoRecord[];
  warnings: string[];
  valid: boolean;
};

type FlattenedRow = {
  todo: TodoRecord;
  depth: number;
};

type VisibleTreeCache = {
  key: string;
  roots: TodoRecord[];
  childrenById: Map<string, TodoRecord[]>;
  rows: FlattenedRow[];
};

type MarkedTodosPayload = {
  count: number;
  text: string;
};

const COMMAND_NAME = "repo-todos";
const TODO_DIRECTORIES = ["todos", "todo", "tasks"] as const;
const TODO_IGNORED_FILENAMES = new Set(["template.md", "readme.md"]);
const TODO_FILENAME_RE = /^(\d+(?:\.\d+)*)-([^.].*)\.md$/i;
const OVERLAY_MAX_HEIGHT = "90%";
const OVERLAY_MAX_HEIGHT_RATIO = 0.9;
const OVERLAY_MIN_WIDTH = 42;
const OVERLAY_MARGIN = 1;
const MIN_TERMINAL_COLUMNS = OVERLAY_MIN_WIDTH + OVERLAY_MARGIN * 2;
const FRAME_HEADER_HEIGHT = 7;
const FRAME_FOOTER_HEIGHT = 3;
const FRAME_CHROME_HEIGHT = FRAME_HEADER_HEIGHT + FRAME_FOOTER_HEIGHT;
const HEIGHT_SAFETY_MARGIN = 1;
const FRAME_COLOR = "muted";
const LIST_WIDTH_RATIO = 0.42;
const LIST_MIN_WIDTH = 28;
const LIST_MAX_WIDTH = 56;
const PREVIEW_MIN_WIDTH = 24;
const DIVIDER_WIDTH = 3;
const HORIZONTAL_SPLIT_MIN_CONTENT_WIDTH =
  LIST_MIN_WIDTH + DIVIDER_WIDTH + PREVIEW_MIN_WIDTH;
const VERTICAL_LIST_HEIGHT_RATIO = 0.45;
const VERTICAL_LIST_MIN_HEIGHT = 6;
const VERTICAL_PREVIEW_MIN_HEIGHT = 6;
const FILTER_INPUT_LABEL = "Filter";
const FILTER_INPUT_HINT = "id/title/label";
const MAX_QUERY_TOKENS = 8;
const RECOMMENDED_FIELDS = [
  "title",
  "status",
  "priority",
  "type",
  "created",
  "parent",
  "blocked-by",
  "blocks",
] as const;
const STATUS_ORDER = new Map<string, number>([
  ["in_progress", 0],
  ["open", 1],
  ["blocked", 2],
  ["done", 3],
  ["unknown", 4],
]);
const STATUS_ALIASES = new Map<string, TodoFrontmatter["status"]>([
  ["todo", "open"],
  ["open", "open"],
  ["in_progress", "in_progress"],
  ["in-progress", "in_progress"],
  ["in progress", "in_progress"],
  ["doing", "in_progress"],
  ["blocked", "blocked"],
  ["done", "done"],
  ["closed", "done"],
  ["completed", "done"],
]);
const PRIORITY_ORDER = new Map<string, number>([
  ["high", 0],
  ["medium", 1],
  ["low", 2],
  ["unknown", 3],
]);
const TYPE_ORDER = new Map<string, number>([
  ["bug", 0],
  ["feature", 1],
  ["docs", 2],
  ["refactor", 3],
  ["chore", 4],
  ["epic", 5],
  ["unknown", 6],
]);

type TodoFile = {
  name: string;
  id: string;
  slug: string;
};

type TodoDirectoryScan = {
  dir: string;
  entries: string[];
};

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseArrayValue(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "[]") return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(",")
      .map((item) => stripQuotes(item).trim())
      .filter(Boolean);
  }
  return trimmed
    .split(",")
    .map((item) => stripQuotes(item).trim())
    .filter(Boolean);
}

function normalizeStatus(status: string): TodoFrontmatter["status"] {
  const normalized = stripQuotes(status)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return STATUS_ALIASES.get(normalized) ?? "unknown";
}

function normalizeParent(value: string): string | null {
  const normalized = stripQuotes(value).trim();
  if (!normalized || normalized.toLowerCase() === "null") {
    return null;
  }
  return normalized;
}

function parseTodoFilename(name: string): TodoFile | null {
  const match = name.match(TODO_FILENAME_RE);
  if (!match) return null;
  return { name, id: match[1], slug: match[2] };
}

function isIgnoredTodoFilename(name: string): boolean {
  return TODO_IGNORED_FILENAMES.has(name.trim().toLowerCase());
}

function inferParentFromId(id: string): string | null {
  const parts = id.split(".");
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join(".");
}

function parseFrontmatter(content: string): {
  raw: Map<string, string>;
  body: string;
} | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return null;
  }

  const rawBlock = match[1];
  const body = match[2] ?? "";
  const raw = new Map<string, string>();

  for (const line of rawBlock.split(/\r?\n/)) {
    const lineMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!lineMatch) continue;
    raw.set(lineMatch[1], lineMatch[2]);
  }

  return { raw, body };
}

async function discoverTodoDirectory(cwd: string): Promise<{
  todosDir: string;
  entries: string[];
  issues: string[];
}> {
  const scans: TodoDirectoryScan[] = [];

  for (const dirName of TODO_DIRECTORIES) {
    const dir = path.join(cwd, dirName);
    try {
      const entries = await fs.readdir(dir);
      scans.push({ dir, entries });
    } catch {
      // ignore missing directory
    }
  }

  if (scans.length === 0) {
    const searched = TODO_DIRECTORIES.map((dirName) => path.join(cwd, dirName));
    return {
      todosDir: path.join(cwd, TODO_DIRECTORIES[0]),
      entries: [],
      issues: [`No todo directory found. Searched: ${searched.join(", ")}`],
    };
  }

  const selected =
    scans.find((scan) =>
      scan.entries.some((entry) => entry.toLowerCase().endsWith(".md")),
    ) ?? scans[0];

  const issues: string[] = [];
  if (scans.length > 1) {
    const others = scans
      .map((scan) => scan.dir)
      .filter((dir) => dir !== selected.dir)
      .map((dir) => path.basename(dir));
    issues.push(
      `Multiple todo directories found; using ${path.basename(selected.dir)} (also found: ${others.join(", ")})`,
    );
  }

  return { todosDir: selected.dir, entries: selected.entries, issues };
}

function parseSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = body.split(/\r?\n/);
  let current = "";
  let buffer: string[] = [];

  const flush = () => {
    if (!current) return;
    sections.set(current, buffer.join("\n").trim());
  };

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      flush();
      current = heading[1].trim();
      buffer = [];
      continue;
    }
    if (current) buffer.push(line);
  }

  flush();
  return sections;
}

function compareIds(a: string, b: string): number {
  const parse = (id: string) => id.split(".").map((part) => Number(part));
  const aa = parse(a);
  const bb = parse(b);
  const max = Math.max(aa.length, bb.length);
  for (let i = 0; i < max; i += 1) {
    const av = aa[i] ?? -1;
    const bv = bb[i] ?? -1;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function todoMatchesQuery(todo: TodoRecord, query: string): boolean {
  const trimmed = normalizeText(query).toLowerCase();
  if (!trimmed) return true;

  const tokens = trimmed.split(" ").filter(Boolean).slice(0, MAX_QUERY_TOKENS);
  if (tokens.length === 0) return true;

  const haystack = [
    todo.id,
    todo.frontmatter.title,
    todo.slug,
    ...todo.frontmatter.labels,
  ].map((value) => value.toLowerCase());
  return tokens.every((token) =>
    haystack.some((value) => value.includes(token)),
  );
}

function compareTodos(
  a: TodoRecord,
  b: TodoRecord,
  sortMode: SortMode,
): number {
  if (sortMode === "state") {
    const aState = STATUS_ORDER.get(a.frontmatter.status) ?? 99;
    const bState = STATUS_ORDER.get(b.frontmatter.status) ?? 99;
    if (aState !== bState) return aState - bState;
  }

  if (sortMode === "priority") {
    const aPriority = PRIORITY_ORDER.get(a.frontmatter.priority) ?? 99;
    const bPriority = PRIORITY_ORDER.get(b.frontmatter.priority) ?? 99;
    if (aPriority !== bPriority) return aPriority - bPriority;
  }

  if (sortMode === "type") {
    const aType = normalizeTodoType(a.frontmatter.type);
    const bType = normalizeTodoType(b.frontmatter.type);
    const aTypeRank = TYPE_ORDER.get(aType) ?? 99;
    const bTypeRank = TYPE_ORDER.get(bType) ?? 99;
    if (aTypeRank !== bTypeRank) return aTypeRank - bTypeRank;
    if (aType !== bType) return aType.localeCompare(bType);
  }

  return compareIds(a.id, b.id);
}

function hasActiveDescendant(todo: TodoRecord): boolean {
  if (todo.frontmatter.status !== "done") return true;
  return todo.children.some((child) => hasActiveDescendant(child));
}

function collectDescendantIds(todo: TodoRecord): string[] {
  const ids: string[] = [];
  for (const child of todo.children) {
    ids.push(child.id, ...collectDescendantIds(child));
  }
  return ids;
}

function renderState(theme: Theme, status: string): string {
  const color =
    status === "in_progress"
      ? "accent"
      : status === "open"
        ? "warning"
        : status === "blocked"
          ? "error"
          : status === "done"
            ? "success"
            : "muted";
  return theme.fg(color, `[${status}]`);
}

function normalizeTodoType(type: string): string {
  const normalized = stripQuotes(type).trim().toLowerCase();
  if (normalized === "feat") return "feature";
  return normalized || "unknown";
}

function getTypeLabel(type: string): string {
  const normalized = normalizeTodoType(type);
  if (normalized === "feature") return "feat";
  return normalized;
}

function getTypeBadgeBackground(
  type: string,
):
  | "toolErrorBg"
  | "toolSuccessBg"
  | "userMessageBg"
  | "toolPendingBg"
  | "customMessageBg"
  | "selectedBg" {
  const normalized = normalizeTodoType(type);
  if (normalized === "bug") return "toolErrorBg";
  if (normalized === "feature") return "toolSuccessBg";
  if (normalized === "docs") return "userMessageBg";
  if (normalized === "refactor") return "toolPendingBg";
  if (normalized === "chore") return "customMessageBg";
  return "selectedBg";
}

function renderTypeBadge(
  theme: Theme,
  type: string,
  restoreBgAnsi = "",
): string {
  const label = getTypeLabel(type);
  const bg = getTypeBadgeBackground(type);
  const bgReset = "\u001b[49m";
  return `${theme.getBgAnsi(bg)}[${label}]${bgReset}${restoreBgAnsi}`;
}

function renderPriority(theme: Theme, priority: string): string {
  const color =
    priority === "high"
      ? "error"
      : priority === "medium"
        ? "warning"
        : priority === "low"
          ? "muted"
          : "dim";
  return theme.fg(color, `[${priority}]`);
}

function renderLabels(theme: Theme, labels: string[]): string {
  if (labels.length === 0) return "";
  return theme.fg("dim", labels.map((label) => `#${label}`).join(" "));
}

function wrapBlock(text: string, width: number): string[] {
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

function padVisible(text: string, width: number): string {
  const truncated = truncateToWidth(text, width);
  const missing = Math.max(0, width - visibleWidth(truncated));
  return truncated + " ".repeat(missing);
}

function formatHomePath(filePath: string): string {
  const home = process.env.HOME;
  if (home && filePath.startsWith(home)) {
    return `~${filePath.slice(home.length)}` || "~";
  }
  return filePath;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function formatMarkedTodosEditorText(todoPaths: string[]): string {
  const lines = [
    "# read the following todos:",
    ...todoPaths.map((todoPath) => `- ${todoPath}`),
  ];
  return `${lines.join("\n")}\n`;
}

async function scanTodos(
  cwd: string,
): Promise<{ todosDir: string; roots: TodoRecord[]; issues: string[] }> {
  const discovered = await discoverTodoDirectory(cwd);
  const todosDir = discovered.todosDir;
  const issues = [...discovered.issues];

  const files: TodoFile[] = discovered.entries
    .filter((name) => name.toLowerCase().endsWith(".md"))
    .filter((name) => !isIgnoredTodoFilename(name))
    .map((name) => parseTodoFilename(name))
    .filter((entry): entry is TodoFile => Boolean(entry))
    .sort((a, b) => compareIds(a.id, b.id));

  const unmatchedMarkdownFiles = discovered.entries
    .filter((name) => name.toLowerCase().endsWith(".md"))
    .filter((name) => !isIgnoredTodoFilename(name))
    .filter((name) => !parseTodoFilename(name));

  if (unmatchedMarkdownFiles.length > 0) {
    issues.push(
      `Ignored markdown files that do not match todo pattern: ${unmatchedMarkdownFiles.join(", ")}`,
    );
  }

  const todos: TodoRecord[] = [];

  for (const file of files) {
    const fullPath = path.join(todosDir, file.name);
    const warnings: string[] = [];

    let content = "";
    try {
      content = await fs.readFile(fullPath, "utf8");
    } catch (error) {
      issues.push(
        `Failed to read ${file.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    const parsed = parseFrontmatter(content);
    if (!parsed) {
      todos.push({
        id: file.id,
        slug: file.slug,
        path: fullPath,
        filename: file.name,
        frontmatter: {
          title: file.slug,
          status: "unknown",
          priority: "unknown",
          type: "unknown",
          labels: [],
          created: "",
          parent: inferParentFromId(file.id),
          blockedBy: [],
          blocks: [],
        },
        body: content,
        sections: new Map(),
        children: [],
        warnings: ["Missing frontmatter block"],
        valid: false,
      });
      continue;
    }

    const rawStatus = parsed.raw.get("status");
    const status = normalizeStatus(rawStatus ?? "");
    const type = normalizeTodoType(parsed.raw.get("type") ?? "unknown");
    const priority = stripQuotes(parsed.raw.get("priority") ?? "unknown")
      .trim()
      .toLowerCase();
    const explicitParent = normalizeParent(parsed.raw.get("parent") ?? "null");
    const parent = explicitParent ?? inferParentFromId(file.id);

    if (rawStatus && status === "unknown") {
      warnings.push(`Unexpected status value: ${stripQuotes(rawStatus)}`);
    }

    for (const field of RECOMMENDED_FIELDS) {
      if (!parsed.raw.has(field)) {
        warnings.push(`Missing recommended field: ${field}`);
      }
    }

    if (
      type !== "unknown" &&
      !["feature", "bug", "refactor", "chore", "epic", "docs"].includes(type)
    ) {
      warnings.push(`Unexpected type: ${type}`);
    }
    if (
      priority !== "unknown" &&
      !["high", "medium", "low"].includes(priority)
    ) {
      warnings.push(`Unexpected priority: ${priority}`);
    }

    todos.push({
      id: file.id,
      slug: file.slug,
      path: fullPath,
      filename: file.name,
      frontmatter: {
        title: stripQuotes(parsed.raw.get("title") ?? file.slug),
        status,
        priority,
        type,
        labels: parseArrayValue(parsed.raw.get("labels") ?? "[]"),
        created: stripQuotes(parsed.raw.get("created") ?? ""),
        parent,
        blockedBy: parseArrayValue(parsed.raw.get("blocked-by") ?? "[]"),
        blocks: parseArrayValue(parsed.raw.get("blocks") ?? "[]"),
      },
      body: parsed.body.trim(),
      sections: parseSections(parsed.body.trim()),
      children: [],
      warnings,
      valid: warnings.length === 0,
    });
  }

  const byId = new Map<string, TodoRecord>();
  for (const todo of todos) byId.set(todo.id, todo);

  const roots: TodoRecord[] = [];
  for (const todo of todos) {
    const parentId = todo.frontmatter.parent;
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(todo);
      continue;
    }

    if (parentId && !byId.has(parentId)) {
      todo.warnings.push(`Parent not found: ${parentId}`);
      todo.valid = false;
    }
    roots.push(todo);
  }

  return { todosDir, roots, issues };
}

class RepoTodosComponent {
  private roots: TodoRecord[] = [];
  private sortMode: SortMode = "number";
  private focusPane: FocusPane = "list";
  private queryFocus: QueryFocus = "none";
  private splitMode: SplitMode = "horizontal";
  private previewVisibleInList = true;
  private hideDone = true;
  private selectedId?: string;
  private expanded = new Set<string>();
  private listScroll = 0;
  private previewScroll = 0;
  private issues: string[] = [];
  private loading = true;
  private lastError?: string;
  private pendingG = false;
  private dataVersion = 0;
  private markedIds = new Set<string>();
  private filterInput = new Input();
  private visibleTreeCache?: VisibleTreeCache;

  constructor(
    private cwd: string,
    private theme: Theme,
    private requestRender: (full?: boolean) => void,
    private onClose: (payload?: MarkedTodosPayload) => void,
    private onEdit: (path: string) => Promise<void>,
  ) {
    const termWidth = process.stdout.columns ?? 0;
    if (
      termWidth > 0 &&
      this.getContentWidth(termWidth) < HORIZONTAL_SPLIT_MIN_CONTENT_WIDTH
    ) {
      this.splitMode = "vertical";
    }
    this.filterInput.onSubmit = () => {
      this.queryFocus = "none";
      this.invalidateTreeCache();
      this.clampSelectionIntoView(this.getListPaneHeight(this.getBodyHeight()));
      this.requestRender();
    };
    this.filterInput.onEscape = () => {
      this.queryFocus = "none";
      this.requestRender();
    };
  }

  async init(): Promise<void> {
    await this.reload();
  }

  private invalidateTreeCache(): void {
    this.visibleTreeCache = undefined;
  }

  async reload(): Promise<void> {
    this.loading = true;
    this.lastError = undefined;
    this.requestRender();

    try {
      const previousSelection = this.selectedId;
      const { roots, issues } = await scanTodos(this.cwd);
      this.roots = roots;
      this.issues = issues;
      this.pruneMarkedIds();
      this.dataVersion += 1;
      this.invalidateTreeCache();
      this.seedExpansion(this.roots);
      const rows = this.getVisibleRows();
      this.selectedId =
        rows.find((row) => row.todo.id === previousSelection)?.todo.id ??
        rows[0]?.todo.id;
      this.clampSelectionIntoView(this.getListPaneHeight(this.getBodyHeight()));
      this.previewScroll = 0;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
      this.requestRender();
    }
  }

  private seedExpansion(todos: TodoRecord[]): void {
    const next = new Set<string>();
    const walk = (todo: TodoRecord, depth: number) => {
      const isExpandable = todo.children.length > 0;
      const shouldExpand =
        depth === 0 ||
        hasActiveDescendant(todo) ||
        todo.frontmatter.type === "epic";
      if (isExpandable && shouldExpand) {
        next.add(todo.id);
      }
      for (const child of todo.children) walk(child, depth + 1);
    };
    for (const todo of todos) walk(todo, 0);
    for (const id of this.expanded) next.add(id);
    this.expanded = next;
    this.invalidateTreeCache();
  }

  private getBodyHeight(): number {
    const rows = process.stdout.rows ?? 30;
    const maxOverlayHeight = Math.floor(rows * OVERLAY_MAX_HEIGHT_RATIO);
    return Math.max(
      10,
      maxOverlayHeight - FRAME_CHROME_HEIGHT - HEIGHT_SAFETY_MARGIN,
    );
  }

  private getContentWidth(width: number): number {
    return Math.max(40, width - 2);
  }

  private getEffectiveSplitMode(width: number): SplitMode {
    const contentWidth = this.getContentWidth(width);
    if (
      this.splitMode === "horizontal" &&
      contentWidth < HORIZONTAL_SPLIT_MIN_CONTENT_WIDTH
    ) {
      return "vertical";
    }
    return this.splitMode;
  }

  private getListPaneHeight(
    bodyHeight: number,
    splitMode: SplitMode = this.splitMode,
  ): number {
    if (splitMode === "horizontal") {
      return bodyHeight;
    }

    const candidate = Math.floor(bodyHeight * VERTICAL_LIST_HEIGHT_RATIO);
    const minListHeight = Math.min(
      VERTICAL_LIST_MIN_HEIGHT,
      Math.max(1, bodyHeight - VERTICAL_PREVIEW_MIN_HEIGHT - 1),
    );
    return Math.max(minListHeight, candidate);
  }

  private isDone(todo: TodoRecord): boolean {
    return todo.frontmatter.status === "done";
  }

  private getQuery(): string {
    return this.filterInput.getValue();
  }

  private shouldShow(todo: TodoRecord): boolean {
    const matchesSelf = todoMatchesQuery(todo, this.getQuery());
    const visibleChildren = todo.children.some((child) =>
      this.shouldShow(child),
    );
    const visibleByDoneState =
      !this.hideDone || !this.isDone(todo) || visibleChildren;
    return visibleByDoneState && (matchesSelf || visibleChildren);
  }

  private getVisibleTree(): VisibleTreeCache {
    const cacheKey = `${this.dataVersion}|${this.sortMode}|${this.hideDone}|${[...this.expanded].sort().join(",")}`;
    if (this.visibleTreeCache?.key === cacheKey) {
      return this.visibleTreeCache;
    }

    const childrenById = new Map<string, TodoRecord[]>();
    const rows: FlattenedRow[] = [];

    const sortVisible = (todos: TodoRecord[]): TodoRecord[] =>
      [...todos]
        .filter((todo) => this.shouldShow(todo))
        .sort((a, b) => compareTodos(a, b, this.sortMode));

    const walk = (todo: TodoRecord, depth: number) => {
      rows.push({ todo, depth });
      const children = childrenById.get(todo.id) ?? [];
      if (children.length > 0 && this.expanded.has(todo.id)) {
        for (const child of children) {
          walk(child, depth + 1);
        }
      }
    };

    const populateChildren = (todo: TodoRecord) => {
      const children = sortVisible(todo.children);
      childrenById.set(todo.id, children);
      for (const child of children) {
        populateChildren(child);
      }
    };

    const roots = sortVisible(this.roots);
    for (const root of roots) {
      populateChildren(root);
    }
    for (const root of roots) {
      walk(root, 0);
    }

    this.visibleTreeCache = { key: cacheKey, roots, childrenById, rows };
    return this.visibleTreeCache;
  }

  private getVisibleChildren(todo: TodoRecord): TodoRecord[] {
    return this.getVisibleTree().childrenById.get(todo.id) ?? [];
  }

  private getVisibleRoots(): TodoRecord[] {
    return this.getVisibleTree().roots;
  }

  private getVisibleRows(): FlattenedRow[] {
    return this.getVisibleTree().rows;
  }

  private getSelectedRowIndex(rows = this.getVisibleRows()): number {
    const index = rows.findIndex((row) => row.todo.id === this.selectedId);
    return index >= 0 ? index : 0;
  }

  private getSelectedTodo(): TodoRecord | undefined {
    return this.getVisibleRows()[this.getSelectedRowIndex()]?.todo;
  }

  private clampSelectionIntoView(bodyHeight: number): void {
    const rows = this.getVisibleRows();
    if (rows.length === 0) {
      this.listScroll = 0;
      this.selectedId = undefined;
      return;
    }

    if (
      !this.selectedId ||
      !rows.some((row) => row.todo.id === this.selectedId)
    ) {
      this.selectedId = rows[0].todo.id;
    }

    const index = this.getSelectedRowIndex(rows);
    if (index < this.listScroll) {
      this.listScroll = index;
    } else if (index >= this.listScroll + bodyHeight) {
      this.listScroll = index - bodyHeight + 1;
    }

    const maxScroll = Math.max(0, rows.length - bodyHeight);
    this.listScroll = Math.max(0, Math.min(this.listScroll, maxScroll));
  }

  private moveSelection(delta: number): void {
    const rows = this.getVisibleRows();
    if (rows.length === 0) return;
    const current = this.getSelectedRowIndex(rows);
    const next = Math.max(0, Math.min(rows.length - 1, current + delta));
    this.selectedId = rows[next].todo.id;
    this.previewScroll = 0;
    this.clampSelectionIntoView(this.getListPaneHeight(this.getBodyHeight()));
  }

  private toggleExpanded(todo: TodoRecord | undefined): void {
    if (!todo || this.getVisibleChildren(todo).length === 0) return;
    if (this.expanded.has(todo.id)) {
      const descendants = collectDescendantIds(todo);
      this.expanded.delete(todo.id);
      for (const id of descendants) this.expanded.delete(id);
    } else {
      this.expanded.add(todo.id);
    }
    this.invalidateTreeCache();
    this.clampSelectionIntoView(this.getListPaneHeight(this.getBodyHeight()));
  }

  private expandSelected(): void {
    const todo = this.getSelectedTodo();
    if (!todo) return;
    const visibleChildren = this.getVisibleChildren(todo);
    if (visibleChildren.length > 0 && !this.expanded.has(todo.id)) {
      this.expanded.add(todo.id);
      this.invalidateTreeCache();
      this.clampSelectionIntoView(this.getListPaneHeight(this.getBodyHeight()));
      return;
    }
    if (visibleChildren.length > 0) {
      const rows = this.getVisibleRows();
      const current = this.getSelectedRowIndex(rows);
      const next = rows[current + 1];
      if (next) {
        this.selectedId = next.todo.id;
        this.previewScroll = 0;
        this.clampSelectionIntoView(
          this.getListPaneHeight(this.getBodyHeight()),
        );
      }
    }
  }

  private collapseSelected(): void {
    const rows = this.getVisibleRows();
    const selected = rows[this.getSelectedRowIndex(rows)];
    if (!selected) return;

    if (
      this.getVisibleChildren(selected.todo).length > 0 &&
      this.expanded.has(selected.todo.id)
    ) {
      this.expanded.delete(selected.todo.id);
      this.invalidateTreeCache();
      this.clampSelectionIntoView(this.getListPaneHeight(this.getBodyHeight()));
      return;
    }

    if (selected.depth <= 0) return;
    for (let i = this.getSelectedRowIndex(rows) - 1; i >= 0; i -= 1) {
      if (rows[i].depth === selected.depth - 1) {
        this.selectedId = rows[i].todo.id;
        this.previewScroll = 0;
        this.clampSelectionIntoView(
          this.getListPaneHeight(this.getBodyHeight()),
        );
        return;
      }
    }
  }

  private cycleSortMode(): void {
    this.sortMode =
      this.sortMode === "number"
        ? "state"
        : this.sortMode === "state"
          ? "priority"
          : this.sortMode === "priority"
            ? "type"
            : "number";
    this.invalidateTreeCache();
    this.clampSelectionIntoView(this.getListPaneHeight(this.getBodyHeight()));
  }

  private toggleHideDone(): void {
    this.hideDone = !this.hideDone;
    this.invalidateTreeCache();
    this.clampSelectionIntoView(this.getListPaneHeight(this.getBodyHeight()));
    this.previewScroll = 0;
  }

  private toggleSplitMode(): void {
    this.splitMode =
      this.splitMode === "horizontal" ? "vertical" : "horizontal";
    this.clampSelectionIntoView(this.getListPaneHeight(this.getBodyHeight()));
  }

  private togglePreviewVisibilityInList(): void {
    this.previewVisibleInList = !this.previewVisibleInList;
    this.clampSelectionIntoView(this.getListPaneHeight(this.getBodyHeight()));
  }

  private focusFilterInput(): void {
    this.queryFocus = "input";
    this.requestRender();
  }

  private blurFilterInput(): void {
    this.queryFocus = "none";
  }

  private getTodoDisplayPath(todo: TodoRecord): string {
    return (
      path.relative(path.join(this.cwd, "todos"), todo.path) || todo.filename
    );
  }

  private collectTodosById(): Map<string, TodoRecord> {
    const byId = new Map<string, TodoRecord>();
    const walk = (todos: TodoRecord[]) => {
      for (const todo of todos) {
        byId.set(todo.id, todo);
        walk(todo.children);
      }
    };
    walk(this.roots);
    return byId;
  }

  private pruneMarkedIds(): void {
    const byId = this.collectTodosById();
    for (const id of this.markedIds) {
      if (!byId.has(id)) {
        this.markedIds.delete(id);
      }
    }
  }

  private toggleMarkForSelected(): void {
    const todo = this.getSelectedTodo();
    if (!todo) return;

    if (this.markedIds.has(todo.id)) {
      this.markedIds.delete(todo.id);
    } else {
      this.markedIds.add(todo.id);
    }
  }

  private buildMarkedTodosPayload(): MarkedTodosPayload | undefined {
    if (this.markedIds.size === 0) return undefined;

    const byId = this.collectTodosById();
    const todos = [...this.markedIds]
      .map((id) => byId.get(id))
      .filter((todo): todo is TodoRecord => Boolean(todo))
      .sort((a, b) => compareIds(a.id, b.id));

    if (todos.length === 0) return undefined;

    const todoPaths = todos.map((todo) =>
      path.relative(this.cwd, todo.path).replaceAll(path.sep, "/"),
    );

    return {
      count: todos.length,
      text: formatMarkedTodosEditorText(todoPaths),
    };
  }

  private buildSummaryPreview(todo: TodoRecord, width: number): string[] {
    const lines: string[] = [];
    const heading = `${todo.frontmatter.title} (${todo.id})`;
    lines.push(
      ...wrapBlock(this.theme.fg("accent", this.theme.bold(heading)), width),
    );
    lines.push(
      ...wrapBlock(
        `${renderState(this.theme, todo.frontmatter.status)}  ${renderTypeBadge(this.theme, todo.frontmatter.type)}  ${renderPriority(this.theme, todo.frontmatter.priority)}`,
        width,
      ),
    );
    lines.push(
      ...wrapBlock(this.theme.fg("dim", this.getTodoDisplayPath(todo)), width),
    );

    if (todo.frontmatter.labels.length > 0) {
      lines.push(
        ...wrapBlock(
          this.theme.fg(
            "muted",
            `Labels: ${todo.frontmatter.labels.map((label) => `#${label}`).join(" ")}`,
          ),
          width,
        ),
      );
    }

    if (todo.frontmatter.parent) {
      lines.push(
        ...wrapBlock(
          this.theme.fg("muted", `Parent: ${todo.frontmatter.parent}`),
          width,
        ),
      );
    }
    if (todo.frontmatter.blockedBy.length > 0) {
      lines.push(
        ...wrapBlock(
          this.theme.fg(
            "warning",
            `Blocked by: ${todo.frontmatter.blockedBy.join(", ")}`,
          ),
          width,
        ),
      );
    }
    if (todo.frontmatter.blocks.length > 0) {
      lines.push(
        ...wrapBlock(
          this.theme.fg(
            "accent",
            `Blocks: ${todo.frontmatter.blocks.join(", ")}`,
          ),
          width,
        ),
      );
    }
    if (todo.warnings.length > 0) {
      lines.push("");
      lines.push(
        ...wrapBlock(
          this.theme.fg("warning", `Warnings: ${todo.warnings.join(" • ")}`),
          width,
        ),
      );
    }

    const sections: Array<[string, string | undefined]> = [
      ["Context", todo.sections.get("Context")],
      ["Acceptance Criteria", todo.sections.get("Acceptance Criteria")],
      ["Affected Files", todo.sections.get("Affected Files")],
      ["E2E Spec", todo.sections.get("E2E Spec")],
      ["Notes", todo.sections.get("Notes")],
    ];

    for (const [label, content] of sections) {
      if (!content) continue;
      lines.push("");
      lines.push(
        ...wrapBlock(this.theme.fg("accent", this.theme.bold(label)), width),
      );
      lines.push(...wrapBlock(content, width));
    }

    return lines;
  }

  private getPreviewLines(width: number): string[] {
    if (this.loading) {
      return wrapBlock(this.theme.fg("muted", "Loading todos..."), width);
    }
    if (this.lastError) {
      return wrapBlock(this.theme.fg("error", this.lastError), width);
    }
    const todo = this.getSelectedTodo();
    if (!todo) {
      return wrapBlock(
        this.theme.fg("muted", "No matching todos found."),
        width,
      );
    }
    return this.buildSummaryPreview(todo, width);
  }

  private renderListPane(width: number, height: number): string[] {
    const rows = this.getVisibleRows();
    this.clampSelectionIntoView(height);
    const slice = rows.slice(this.listScroll, this.listScroll + height);
    const lines: string[] = [];

    if (rows.length === 0) {
      lines.push(
        ...wrapBlock(this.theme.fg("muted", "No todos to show."), width),
      );
    } else {
      for (const row of slice) {
        const todo = row.todo;
        const isSelected = todo.id === this.selectedId;
        const indent = "  ".repeat(row.depth);
        const hasVisibleChildren = this.getVisibleChildren(todo).length > 0;
        const expander = !hasVisibleChildren
          ? "•"
          : this.expanded.has(todo.id)
            ? "▾"
            : "▸";
        const warning =
          todo.warnings.length > 0 ? this.theme.fg("warning", " !") : "";
        const isMarked = this.markedIds.has(todo.id);
        const selectedBgAnsi = isSelected
          ? this.theme.getBgAnsi("selectedBg")
          : "";
        const typeBadge = renderTypeBadge(
          this.theme,
          todo.frontmatter.type,
          selectedBgAnsi,
        );
        const priority = renderPriority(this.theme, todo.frontmatter.priority);
        const labels = renderLabels(this.theme, todo.frontmatter.labels);
        const labelsSuffix = labels ? ` ${labels}` : "";
        let line = `${indent}${expander} ${renderState(this.theme, todo.frontmatter.status)} ${typeBadge} ${this.theme.fg("accent", `[${todo.id}]`)} ${todo.frontmatter.title} ${priority}${labelsSuffix}${warning}`;
        if (isMarked) {
          line = this.theme.bold(line);
        }
        line = truncateToWidth(line, width);
        if (isSelected) {
          line = this.theme.bg("selectedBg", padVisible(line, width));
        } else {
          line = padVisible(line, width);
        }
        lines.push(line);
      }
    }

    while (lines.length < height) lines.push(" ".repeat(width));
    return lines.slice(0, height);
  }

  private renderPreviewPane(width: number, height: number): string[] {
    const allLines = this.getPreviewLines(width);
    const maxScroll = Math.max(0, allLines.length - height);
    this.previewScroll = Math.max(0, Math.min(this.previewScroll, maxScroll));
    const lines = allLines
      .slice(this.previewScroll, this.previewScroll + height)
      .map((line) => padVisible(line, width));
    while (lines.length < height) lines.push(" ".repeat(width));
    return lines;
  }

  handleInput(data: string): void {
    if (this.queryFocus === "input") {
      if (matchesKey(data, Key.ctrl("f"))) {
        this.blurFilterInput();
        this.requestRender();
        return;
      }
      this.filterInput.handleInput(data);
      this.invalidateTreeCache();
      this.clampSelectionIntoView(this.getListPaneHeight(this.getBodyHeight()));
      this.requestRender();
      return;
    }

    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl("c")) ||
      data === "q"
    ) {
      this.pendingG = false;
      this.onClose(this.buildMarkedTodosPayload());
      return;
    }

    if (matchesKey(data, Key.ctrl("f")) || data === "/") {
      this.focusFilterInput();
      return;
    }

    if (data === "g") {
      if (this.pendingG) {
        this.pendingG = false;
        if (this.focusPane === "preview") {
          this.previewScroll = 0;
        } else {
          this.moveSelection(-9999);
        }
        this.requestRender();
      } else {
        this.pendingG = true;
      }
      return;
    }

    if (data === "G") {
      this.pendingG = false;
      if (this.focusPane === "preview") {
        this.previewScroll = Number.MAX_SAFE_INTEGER;
      } else {
        this.moveSelection(9999);
      }
      this.requestRender();
      return;
    }

    this.pendingG = false;

    if (matchesKey(data, Key.tab)) {
      this.toggleExpanded(this.getSelectedTodo());
      this.requestRender();
      return;
    }

    if (matchesKey(data, Key.enter)) {
      this.focusPane = this.focusPane === "list" ? "preview" : "list";
      this.requestRender();
      return;
    }

    if (data === "s") {
      this.cycleSortMode();
      this.requestRender();
      return;
    }
    if (data === "t") {
      this.toggleSplitMode();
      this.requestRender();
      return;
    }
    if (data === "d") {
      this.toggleHideDone();
      this.requestRender();
      return;
    }
    if (data === "v") {
      if (this.focusPane === "list") {
        this.togglePreviewVisibilityInList();
        this.requestRender();
      }
      return;
    }
    if (data === "r") {
      void this.reload();
      return;
    }
    if (data === "e") {
      const todo = this.getSelectedTodo();
      if (todo) {
        void this.onEdit(todo.path);
      }
      return;
    }
    if (data === "m") {
      this.toggleMarkForSelected();
      this.requestRender();
      return;
    }

    const page = Math.max(5, Math.floor(this.getBodyHeight() * 0.8));
    if (matchesKey(data, Key.ctrl("u"))) {
      this.previewScroll -= page;
      this.requestRender();
      return;
    }
    if (matchesKey(data, Key.ctrl("d"))) {
      this.previewScroll += page;
      this.requestRender();
      return;
    }

    if (this.focusPane === "preview") {
      if (matchesKey(data, Key.up) || data === "k") this.previewScroll -= 1;
      else if (matchesKey(data, Key.down) || data === "j")
        this.previewScroll += 1;
      else if (matchesKey(data, "pageUp")) this.previewScroll -= page;
      else if (matchesKey(data, "pageDown")) this.previewScroll += page;
      else if (matchesKey(data, Key.home)) this.previewScroll = 0;
      else if (matchesKey(data, Key.end))
        this.previewScroll = Number.MAX_SAFE_INTEGER;
      else return;
      this.requestRender();
      return;
    }

    if (matchesKey(data, Key.up) || data === "k") this.moveSelection(-1);
    else if (matchesKey(data, Key.down) || data === "j") this.moveSelection(1);
    else if (matchesKey(data, "pageUp")) this.moveSelection(-page);
    else if (matchesKey(data, "pageDown")) this.moveSelection(page);
    else if (matchesKey(data, Key.left) || data === "h")
      this.collapseSelected();
    else if (matchesKey(data, Key.right) || data === "l") this.expandSelected();
    else if (matchesKey(data, Key.space))
      this.toggleExpanded(this.getSelectedTodo());
    else if (matchesKey(data, Key.home)) this.moveSelection(-9999);
    else if (matchesKey(data, Key.end)) this.moveSelection(9999);
    else return;

    this.requestRender();
  }

  render(width: number): string[] {
    const contentWidth = this.getContentWidth(width);
    const bodyHeight = this.getBodyHeight();
    const isPreviewFocused = this.focusPane === "preview";
    const effectiveSplitMode = this.getEffectiveSplitMode(width);
    const isListOnly = !isPreviewFocused && !this.previewVisibleInList;
    const isVerticalSplit =
      !isPreviewFocused && !isListOnly && effectiveSplitMode === "vertical";
    const leftWidth = isPreviewFocused
      ? 0
      : isListOnly || isVerticalSplit
        ? contentWidth
        : Math.max(
            LIST_MIN_WIDTH,
            Math.min(
              LIST_MAX_WIDTH,
              Math.floor(contentWidth * LIST_WIDTH_RATIO),
            ),
          );
    const rightWidth = isPreviewFocused
      ? contentWidth
      : isListOnly
        ? 0
        : isVerticalSplit
          ? contentWidth
          : Math.max(
              PREVIEW_MIN_WIDTH,
              contentWidth - leftWidth - DIVIDER_WIDTH,
            );
    const listHeight = isPreviewFocused
      ? 0
      : isListOnly
        ? bodyHeight
        : this.getListPaneHeight(bodyHeight, effectiveSplitMode);
    const previewHeight = isPreviewFocused
      ? bodyHeight
      : isListOnly
        ? 0
        : isVerticalSplit
          ? bodyHeight - listHeight - 1
          : bodyHeight;

    const visibleRows = this.getVisibleRows();
    const selected = this.getSelectedTodo();

    const borderFg = (text: string) => this.theme.fg(FRAME_COLOR, text);
    const title = this.theme.bold(" Repo Todos ");
    const focusLabel =
      this.focusPane === "list"
        ? this.theme.fg("accent", "[list]")
        : this.theme.fg("accent", "[preview]");
    const subTitle = this.theme.fg(
      "dim",
      `${formatHomePath(this.cwd)}/todos • ${visibleRows.length} visible • sort:${this.sortMode} • completed:${this.hideDone ? "hidden" : "shown"} • preview:${this.previewVisibleInList ? "shown" : "hidden"} • layout:${effectiveSplitMode}${effectiveSplitMode !== this.splitMode ? " (auto)" : ""}`,
    );
    const queryValue = this.getQuery();
    const queryDisplay = queryValue || FILTER_INPUT_HINT;
    const queryPrefix = `${FILTER_INPUT_LABEL}: `;
    const queryLine =
      this.queryFocus === "input"
        ? `${queryPrefix}${this.filterInput.render(Math.max(8, contentWidth - queryPrefix.length))[0] ?? ""}`
        : `${queryPrefix}${this.theme.fg(queryValue ? "text" : "muted", queryDisplay)}`;
    const selectedLine = selected
      ? `${this.theme.fg(this.markedIds.has(selected.id) ? "success" : "muted", this.markedIds.has(selected.id) ? "☑" : "☐")} ${this.theme.fg("muted", `[${selected.id}] ${selected.frontmatter.title}`)}`
      : this.theme.fg("muted", "☐ none");

    const makeBorderLine = (
      left: string,
      fill: string,
      right: string,
      label = "",
    ) => {
      const fillWidth = Math.max(0, contentWidth - visibleWidth(label));
      const content = truncateToWidth(
        label + fill.repeat(fillWidth),
        contentWidth,
        "",
      );
      return `${borderFg(left)}${borderFg(content)}${borderFg(right)}`;
    };
    const makeDividerLine = () =>
      `${borderFg("┣")}${borderFg("━".repeat(contentWidth))}${borderFg("┫")}`;
    const frameLine = (content: string) =>
      `${borderFg("┃")}${padVisible(content, contentWidth)}${borderFg("┃")}`;

    const header = [
      makeBorderLine("┏", "━", "┓", title),
      frameLine(focusLabel),
      frameLine(subTitle),
      frameLine(queryLine),
      frameLine(selectedLine),
      makeDividerLine(),
    ];

    const left = isPreviewFocused
      ? []
      : this.renderListPane(leftWidth, listHeight);
    const right =
      isPreviewFocused || !isListOnly
        ? this.renderPreviewPane(rightWidth, previewHeight)
        : [];
    const body: string[] = [];

    if (isPreviewFocused) {
      for (let i = 0; i < bodyHeight; i += 1) {
        body.push(frameLine(padVisible(right[i] ?? "", contentWidth)));
      }
    } else if (isListOnly) {
      for (let i = 0; i < bodyHeight; i += 1) {
        body.push(frameLine(padVisible(left[i] ?? "", contentWidth)));
      }
    } else if (isVerticalSplit) {
      for (let i = 0; i < listHeight; i += 1) {
        body.push(frameLine(padVisible(left[i] ?? "", contentWidth)));
      }
      body.push(
        frameLine(this.theme.fg("borderMuted", "─".repeat(contentWidth))),
      );
      for (let i = 0; i < previewHeight; i += 1) {
        body.push(frameLine(padVisible(right[i] ?? "", contentWidth)));
      }
    } else {
      for (let i = 0; i < bodyHeight; i += 1) {
        const line = `${padVisible(left[i] ?? "", leftWidth)}${this.theme.fg("borderMuted", " │ ")}${padVisible(right[i] ?? "", rightWidth)}`;
        body.push(frameLine(line));
      }
    }

    const footerText =
      "/ or ctrl-f filter • tab fold • enter focus/unfocus • v preview • t layout • s sort • d hide done • m mark • e edit • r rescan • q/esc close";
    const footerExtra =
      this.issues.length > 0
        ? ` • ${this.issues[0]}`
        : this.lastError
          ? ` • error: ${this.lastError}`
          : "";
    const footer = [
      makeDividerLine(),
      frameLine(this.theme.fg("dim", footerText + footerExtra)),
      makeBorderLine("┗", "━", "┛"),
    ];

    return [...header, ...body, ...footer];
  }

  invalidate(): void {}
}

export default function repoTodosExtension(pi: ExtensionAPI) {
  pi.registerCommand(COMMAND_NAME, {
    description: "Browse ./todos in a read-only tree with preview",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify(`/${COMMAND_NAME} requires interactive mode`, "error");
        return;
      }

      const termWidth = process.stdout.columns ?? 0;
      if (termWidth < MIN_TERMINAL_COLUMNS) {
        ctx.ui.notify(
          `/${COMMAND_NAME} requires at least ${MIN_TERMINAL_COLUMNS} columns (current: ${termWidth})`,
          "warning",
        );
        return;
      }

      const markedTodos = await ctx.ui.custom<MarkedTodosPayload | undefined>(
        (tui, theme, _kb, done) => {
          const openEditor = async (filePath: string) => {
            const editorCmd = process.env.VISUAL || process.env.EDITOR;
            if (!editorCmd) {
              ctx.ui.notify(
                "Set $VISUAL or $EDITOR to edit todo files",
                "warning",
              );
              return;
            }

            const [editor, ...editorArgs] = editorCmd.split(" ");
            tui.stop();
            try {
              const result = spawnSync(editor, [...editorArgs, filePath], {
                stdio: "inherit",
                shell: process.platform === "win32",
              });
              if (result.status && result.status !== 0) {
                ctx.ui.notify(
                  `Editor exited with code ${result.status}`,
                  "warning",
                );
              }
            } catch (error) {
              ctx.ui.notify(
                `Failed to open editor: ${error instanceof Error ? error.message : String(error)}`,
                "error",
              );
            } finally {
              tui.start();
              tui.requestRender(true);
              void component.reload();
            }
          };

          const component = new RepoTodosComponent(
            ctx.cwd,
            theme,
            (full) => tui.requestRender(Boolean(full)),
            (payload) => done(payload),
            openEditor,
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

      if (markedTodos) {
        ctx.ui.setEditorText(markedTodos.text);
        ctx.ui.notify(
          `Loaded ${markedTodos.count} marked todo${markedTodos.count === 1 ? "" : "s"} into the editor`,
          "info",
        );
      }
    },
  });
}
