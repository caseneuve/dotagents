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
import os from "node:os";
import path from "node:path";

type FocusPane = "list" | "preview";
type QueryFocus = "none" | "input";
type SplitMode = "horizontal" | "vertical";

type JournalMetadata = {
  title: string;
  date: string;
  project: string | null;
  tags: string[];
};

type JournalEntry = {
  path: string;
  metadata: JournalMetadata;
  body: string;
  timestamp: number;
};

type JournalScanResult = {
  entries: JournalEntry[];
  issues: string[];
};

type MarkedEntriesPayload = {
  count: number;
  text: string;
};

type JournalFilter = {
  query: string;
  currentProject: string | null;
  currentProjectOnly: boolean;
};

type ParsedOrgFile = {
  metadata: JournalMetadata;
  body: string;
};

const COMMAND_NAME = "agent-journal";
const HOME_DIR = process.env.HOME || os.homedir();
const JOURNAL_ROOT = path.join(HOME_DIR, "org", "agent-journal");
const JOURNAL_FILE_EXTENSION = ".org";
const INDEX_BASENAME = "index.org";
const OVERLAY_MAX_HEIGHT = "90%";
const OVERLAY_MAX_HEIGHT_RATIO = 0.9;
const OVERLAY_MIN_WIDTH = 100;
const OVERLAY_MARGIN = 1;
const MIN_TERMINAL_COLUMNS = OVERLAY_MIN_WIDTH + OVERLAY_MARGIN * 2;
const FRAME_HEADER_HEIGHT = 7;
const FRAME_FOOTER_HEIGHT = 3;
const FRAME_CHROME_HEIGHT = FRAME_HEADER_HEIGHT + FRAME_FOOTER_HEIGHT;
const HEIGHT_SAFETY_MARGIN = 1;
const FRAME_COLOR = "muted";
const BODY_MIN_HEIGHT = 10;
const LIST_WIDTH_RATIO = 0.5;
const LIST_MIN_WIDTH = 30;
const LIST_MAX_WIDTH = 80;
const PREVIEW_MIN_WIDTH = 24;
const PREVIEW_ONLY_WIDTH_OFFSET = 2;
const VERTICAL_LIST_HEIGHT_RATIO = 0.45;
const VERTICAL_LIST_MIN_HEIGHT = 6;
const VERTICAL_PREVIEW_MIN_HEIGHT = 6;
const CONTENT_MIN_WIDTH = 40;
const DIVIDER_WIDTH = 3;
const MAX_QUERY_TOKENS = 8;
const ORG_META_HEADING = "Meta";
const ORG_PROPERTIES_DRAWER = ":PROPERTIES:";
const ORG_DRAWER_END = ":END:";
const DATE_LINE_RE = /^#\+DATE:\s*(.+)$/im;
const TITLE_LINE_RE = /^#\+TITLE:\s*(.+)$/im;
const FILETAGS_LINE_RE = /^#\+FILETAGS:\s*(.+)$/im;
const PROJECT_PROPERTY_RE = /^:LLM_PROJECT:\s*(.+)$/i;
const FILTER_INPUT_LABEL = "Filter";
const FILTER_INPUT_HINT = "title/tags/project";
const MISSING_PROJECT_LABEL = "no-project";
const UNTAGGED_LABEL = "untagged";

function formatHomePath(filePath: string): string {
  if (filePath.startsWith(HOME_DIR)) {
    return `~${filePath.slice(HOME_DIR.length)}` || "~";
  }
  return filePath;
}

function padVisible(text: string, width: number): string {
  const truncated = truncateToWidth(text, width);
  const missing = Math.max(0, width - visibleWidth(truncated));
  return truncated + " ".repeat(missing);
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

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function formatMarkedEntriesEditorText(entries: JournalEntry[]): string {
  const lines = [
    "# read the following journal entries:",
    ...entries.map((entry) => entry.path),
  ];
  return `${lines.join("\n")}\n`;
}

function parseFileTags(rawValue: string | undefined): string[] {
  if (!rawValue) return [];
  const normalized = rawValue.trim().replace(/^\[/, "").replace(/\]$/, "");
  return normalized
    .split(":")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseDateToTimestamp(date: string): number {
  const normalized = normalizeText(date).replace(" ", "T");
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseOrgFile(content: string): ParsedOrgFile | null {
  const title = TITLE_LINE_RE.exec(content)?.[1]?.trim();
  const date = DATE_LINE_RE.exec(content)?.[1]?.trim();
  if (!title || !date) return null;

  const fileTags = parseFileTags(FILETAGS_LINE_RE.exec(content)?.[1]);
  const lines = content.split(/\r?\n/);

  let inMetaSection = false;
  let inDrawer = false;
  let project: string | null = null;
  const bodyLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("#+")) {
      continue;
    }

    const headingMatch = line.match(/^(\*+)\s+(.*)$/);
    if (headingMatch) {
      const headingText = headingMatch[2]?.trim() ?? "";
      inMetaSection = headingText === ORG_META_HEADING;
      inDrawer = false;
      if (!inMetaSection) {
        bodyLines.push(line);
      }
      continue;
    }

    if (inMetaSection) {
      if (line.trim() === ORG_PROPERTIES_DRAWER) {
        inDrawer = true;
        continue;
      }
      if (line.trim() === ORG_DRAWER_END) {
        inDrawer = false;
        continue;
      }
      if (inDrawer) {
        const projectMatch = line.match(PROJECT_PROPERTY_RE);
        if (projectMatch) {
          const nextProject = projectMatch[1]?.trim();
          project = nextProject ? nextProject : null;
        }
      }
      continue;
    }

    if (line.trim() === ORG_PROPERTIES_DRAWER) {
      inDrawer = true;
      continue;
    }
    if (inDrawer && line.trim() === ORG_DRAWER_END) {
      inDrawer = false;
      continue;
    }
    if (inDrawer) {
      continue;
    }

    bodyLines.push(line);
  }

  return {
    metadata: {
      title,
      date,
      project,
      tags: fileTags,
    },
    body: bodyLines.join("\n").trim(),
  };
}

function entryMatchesProject(
  entry: JournalEntry,
  filter: JournalFilter,
): boolean {
  if (!filter.currentProjectOnly || !filter.currentProject) return true;
  return entry.metadata.project === filter.currentProject;
}

function buildSearchHaystack(entry: JournalEntry): string[] {
  return [
    entry.metadata.title,
    entry.metadata.project ?? MISSING_PROJECT_LABEL,
    entry.metadata.tags.length > 0
      ? entry.metadata.tags.join(" ")
      : UNTAGGED_LABEL,
  ].map((value) => value.toLowerCase());
}

function entryMatchesQuery(entry: JournalEntry, query: string): boolean {
  const trimmed = normalizeText(query).toLowerCase();
  if (!trimmed) return true;

  const tokens = trimmed.split(" ").filter(Boolean).slice(0, MAX_QUERY_TOKENS);
  if (tokens.length === 0) return true;

  const haystack = buildSearchHaystack(entry);
  return tokens.every((token) =>
    haystack.some((value) => value.includes(token)),
  );
}

function applyFilters(
  entries: JournalEntry[],
  filter: JournalFilter,
): JournalEntry[] {
  return entries.filter((entry) => {
    return (
      entryMatchesProject(entry, filter) &&
      entryMatchesQuery(entry, filter.query)
    );
  });
}

function compareByRecencyDesc(a: JournalEntry, b: JournalEntry): number {
  if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
  return a.path.localeCompare(b.path);
}

async function collectOrgFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(JOURNAL_FILE_EXTENSION)) continue;
      if (entry.name === INDEX_BASENAME) continue;
      files.push(fullPath);
    }
  }

  await walk(rootDir);
  return files;
}

async function scanJournalEntries(rootDir: string): Promise<JournalScanResult> {
  const issues: string[] = [];
  let files: string[] = [];

  try {
    files = await collectOrgFiles(rootDir);
  } catch (error) {
    return {
      entries: [],
      issues: [
        `Failed to scan ${rootDir}: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }

  const entries: JournalEntry[] = [];

  for (const filePath of files) {
    let content = "";
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch (error) {
      issues.push(
        `Failed to read ${formatHomePath(filePath)}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    const parsed = parseOrgFile(content);
    if (!parsed) {
      issues.push(
        `Skipped ${formatHomePath(filePath)}: missing #+TITLE or #+DATE`,
      );
      continue;
    }

    entries.push({
      path: filePath,
      metadata: parsed.metadata,
      body: parsed.body,
      timestamp: parseDateToTimestamp(parsed.metadata.date),
    });
  }

  entries.sort(compareByRecencyDesc);
  return { entries, issues };
}

function detectCurrentProject(cwd: string): string | null {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) return null;
  const root = result.stdout.trim();
  if (!root) return null;
  const projectName = path.basename(root).trim();
  return projectName || null;
}

function withAnsi(code: string, text: string, reset = "\u001b[0m"): string {
  return `${code}${text}${reset}`;
}

function renderInlineOrg(theme: Theme, text: string): string {
  const segments = text.split(/(=.+?=|~.+?~|\*[^*]+\*|\/[^/]+\/|\+[^+]+\+)/g);
  return segments
    .map((segment) => {
      if (!segment) return "";
      if (segment.startsWith("=") && segment.endsWith("=")) {
        return theme.fg("mdCode", segment.slice(1, -1));
      }
      if (segment.startsWith("~") && segment.endsWith("~")) {
        return theme.fg("mdCode", segment.slice(1, -1));
      }
      if (segment.startsWith("*") && segment.endsWith("*")) {
        return theme.bold(segment.slice(1, -1));
      }
      if (segment.startsWith("/") && segment.endsWith("/")) {
        return withAnsi("\u001b[3m", segment.slice(1, -1), "\u001b[23m");
      }
      if (segment.startsWith("+") && segment.endsWith("+")) {
        return withAnsi("\u001b[9m", segment.slice(1, -1), "\u001b[29m");
      }
      return segment;
    })
    .join("");
}

function renderBodyLine(theme: Theme, line: string): string {
  const headingMatch = line.match(/^(\*+)\s+(.*)$/);
  if (headingMatch) {
    const depth = headingMatch[1]?.length ?? 1;
    const heading = headingMatch[2]?.trim() ?? "";
    const prefix = `${"  ".repeat(Math.max(0, depth - 1))}● `;
    return `${theme.fg("accent", prefix)}${theme.fg("accent", theme.bold(renderInlineOrg(theme, heading)))}`;
  }

  const bulletMatch = line.match(/^(\s*[-+]\s+)(.*)$/);
  if (bulletMatch) {
    const indent = bulletMatch[1]?.replace(/[-+]/, "•") ?? "• ";
    const content = bulletMatch[2] ?? "";
    return `${theme.fg("mdListBullet", indent)}${renderInlineOrg(theme, content)}`;
  }

  return renderInlineOrg(theme, line);
}

function buildPreviewLines(
  theme: Theme,
  entry: JournalEntry | undefined,
  width: number,
): string[] {
  if (!entry) {
    return wrapBlock(
      theme.fg("muted", "No matching journal entries found."),
      width,
    );
  }

  const lines: string[] = [];
  const projectLabel = entry.metadata.project ?? MISSING_PROJECT_LABEL;
  const tagsLabel =
    entry.metadata.tags.length > 0
      ? entry.metadata.tags.map((tag) => `:${tag}:`).join(" ")
      : UNTAGGED_LABEL;

  lines.push(
    ...wrapBlock(theme.fg("accent", theme.bold(entry.metadata.title)), width),
  );
  lines.push(
    ...wrapBlock(
      theme.fg("dim", `${entry.metadata.date} • ${projectLabel}`),
      width,
    ),
  );
  lines.push(...wrapBlock(theme.fg("muted", tagsLabel), width));
  lines.push("");

  const bodyLines =
    entry.body.length > 0 ? entry.body.split(/\r?\n/) : ["(empty body)"];
  for (const bodyLine of bodyLines) {
    const rendered = renderBodyLine(theme, bodyLine);
    if (!bodyLine.trim()) {
      lines.push("");
      continue;
    }
    lines.push(...wrapBlock(rendered, width));
  }

  return lines;
}

class AgentJournalComponent {
  focused = false;

  private entries: JournalEntry[] = [];
  private filteredEntries: JournalEntry[] = [];
  private issues: string[] = [];
  private loading = true;
  private lastError?: string;
  private selectedPath?: string;
  private listScroll = 0;
  private previewScroll = 0;
  private focusPane: FocusPane = "list";
  private queryFocus: QueryFocus = "none";
  private splitMode: SplitMode = "horizontal";
  private filterInput = new Input();
  private pendingG = false;
  private currentProjectFilterEnabled = false;
  private markedPaths = new Set<string>();

  constructor(
    private journalRoot: string,
    private currentProject: string | null,
    private theme: Theme,
    private requestRender: (full?: boolean) => void,
    private onClose: (payload?: MarkedEntriesPayload) => void,
    private onEdit: (path: string) => Promise<void>,
  ) {
    this.currentProjectFilterEnabled = Boolean(this.currentProject);
    this.filterInput.onSubmit = () => {
      this.queryFocus = "none";
      this.syncFocusableChildren();
      this.refreshFilters();
      this.requestRender();
    };
    this.filterInput.onEscape = () => {
      this.queryFocus = "none";
      this.syncFocusableChildren();
      this.requestRender();
    };
    this.syncFocusableChildren();
  }

  private syncFocusableChildren(): void {
    this.filterInput.focused = this.focused && this.queryFocus === "input";
  }

  async init(): Promise<void> {
    await this.reload();
  }

  private getFilterState(): JournalFilter {
    return {
      query: this.filterInput.getValue(),
      currentProject: this.currentProject,
      currentProjectOnly: Boolean(this.currentProject),
    };
  }

  private getEffectiveFilterState(): JournalFilter {
    const base = this.getFilterState();
    return {
      ...base,
      currentProjectOnly: this.currentProjectFilterEnabled,
    };
  }

  private refreshFilters(): void {
    const previousSelection = this.selectedPath;
    this.filteredEntries = applyFilters(
      this.entries,
      this.getEffectiveFilterState(),
    );
    this.selectedPath =
      this.filteredEntries.find((entry) => entry.path === previousSelection)
        ?.path ?? this.filteredEntries[0]?.path;
    this.clampSelectionIntoView(this.getListPaneHeight(this.getBodyHeight()));
  }

  async reload(): Promise<void> {
    this.loading = true;
    this.lastError = undefined;
    this.requestRender();

    try {
      const previousSelection = this.selectedPath;
      const { entries, issues } = await scanJournalEntries(this.journalRoot);
      this.entries = entries;
      this.issues = issues;
      this.pruneMarkedPaths();
      this.refreshFilters();
      this.selectedPath =
        this.filteredEntries.find((entry) => entry.path === previousSelection)
          ?.path ?? this.filteredEntries[0]?.path;
      this.previewScroll = 0;
      this.clampSelectionIntoView(this.getListPaneHeight(this.getBodyHeight()));
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
      this.requestRender();
    }
  }

  private getBodyHeight(): number {
    const rows = process.stdout.rows ?? 30;
    const maxOverlayHeight = Math.floor(rows * OVERLAY_MAX_HEIGHT_RATIO);
    return Math.max(
      BODY_MIN_HEIGHT,
      maxOverlayHeight - FRAME_CHROME_HEIGHT - HEIGHT_SAFETY_MARGIN,
    );
  }

  private getSelectedIndex(): number {
    const index = this.filteredEntries.findIndex(
      (entry) => entry.path === this.selectedPath,
    );
    return index >= 0 ? index : 0;
  }

  private getSelectedEntry(): JournalEntry | undefined {
    return this.filteredEntries[this.getSelectedIndex()];
  }

  private clampSelectionIntoView(bodyHeight: number): void {
    if (this.filteredEntries.length === 0) {
      this.selectedPath = undefined;
      this.listScroll = 0;
      return;
    }

    if (
      !this.selectedPath ||
      !this.filteredEntries.some((entry) => entry.path === this.selectedPath)
    ) {
      this.selectedPath = this.filteredEntries[0]?.path;
    }

    const selectedIndex = this.getSelectedIndex();
    if (selectedIndex < this.listScroll) {
      this.listScroll = selectedIndex;
    } else if (selectedIndex >= this.listScroll + bodyHeight) {
      this.listScroll = selectedIndex - bodyHeight + 1;
    }

    const maxScroll = Math.max(0, this.filteredEntries.length - bodyHeight);
    this.listScroll = Math.max(0, Math.min(this.listScroll, maxScroll));
  }

  private moveSelection(delta: number): void {
    if (this.filteredEntries.length === 0) return;
    const nextIndex = Math.max(
      0,
      Math.min(
        this.filteredEntries.length - 1,
        this.getSelectedIndex() + delta,
      ),
    );
    this.selectedPath = this.filteredEntries[nextIndex]?.path;
    this.previewScroll = 0;
    this.clampSelectionIntoView(this.getListPaneHeight(this.getBodyHeight()));
  }

  private collectEntriesByPath(): Map<string, JournalEntry> {
    return new Map(this.entries.map((entry) => [entry.path, entry]));
  }

  private pruneMarkedPaths(): void {
    const byPath = this.collectEntriesByPath();
    for (const markedPath of this.markedPaths) {
      if (!byPath.has(markedPath)) {
        this.markedPaths.delete(markedPath);
      }
    }
  }

  private toggleMarkForSelected(): void {
    const entry = this.getSelectedEntry();
    if (!entry) return;

    if (this.markedPaths.has(entry.path)) {
      this.markedPaths.delete(entry.path);
    } else {
      this.markedPaths.add(entry.path);
    }
  }

  private buildMarkedEntriesPayload(): MarkedEntriesPayload | undefined {
    if (this.markedPaths.size === 0) return undefined;

    const byPath = this.collectEntriesByPath();
    const entries = [...this.markedPaths]
      .map((entryPath) => byPath.get(entryPath))
      .filter((entry): entry is JournalEntry => Boolean(entry))
      .sort(compareByRecencyDesc);

    if (entries.length === 0) return undefined;

    return {
      count: entries.length,
      text: formatMarkedEntriesEditorText(entries),
    };
  }

  private toggleCurrentProjectFilter(): void {
    if (!this.currentProject) return;
    this.currentProjectFilterEnabled = !this.currentProjectFilterEnabled;
    this.previewScroll = 0;
    this.refreshFilters();
  }

  private focusFilterInput(): void {
    this.queryFocus = "input";
    this.syncFocusableChildren();
    this.requestRender();
  }

  private blurFilterInput(): void {
    this.queryFocus = "none";
    this.syncFocusableChildren();
  }

  private toggleSplitMode(): void {
    this.splitMode =
      this.splitMode === "horizontal" ? "vertical" : "horizontal";
    this.clampSelectionIntoView(this.getListPaneHeight(this.getBodyHeight()));
  }

  private getListPaneHeight(bodyHeight: number): number {
    if (this.focusPane === "preview") {
      return bodyHeight;
    }
    if (this.splitMode === "horizontal") {
      return bodyHeight;
    }

    const candidate = Math.floor(bodyHeight * VERTICAL_LIST_HEIGHT_RATIO);
    const minListHeight = Math.min(
      VERTICAL_LIST_MIN_HEIGHT,
      Math.max(1, bodyHeight - VERTICAL_PREVIEW_MIN_HEIGHT - 1),
    );
    return Math.max(minListHeight, candidate);
  }

  private renderListPane(width: number, height: number): string[] {
    if (this.loading) {
      return this.fillHeight(
        wrapBlock(this.theme.fg("muted", "Loading journal entries..."), width),
        width,
        height,
      );
    }
    if (this.lastError) {
      return this.fillHeight(
        wrapBlock(this.theme.fg("error", this.lastError), width),
        width,
        height,
      );
    }
    if (this.filteredEntries.length === 0) {
      return this.fillHeight(
        wrapBlock(
          this.theme.fg(
            "muted",
            "No journal entries match the active filters.",
          ),
          width,
        ),
        width,
        height,
      );
    }

    this.clampSelectionIntoView(height);
    const slice = this.filteredEntries.slice(
      this.listScroll,
      this.listScroll + height,
    );
    const lines = slice.map((entry) => {
      const isSelected = entry.path === this.selectedPath;
      const isMarked = this.markedPaths.has(entry.path);
      const project = entry.metadata.project ?? MISSING_PROJECT_LABEL;
      let line = `${entry.metadata.title} ${this.theme.fg("dim", `[${project}]`)}`;
      if (isMarked) {
        line = this.theme.bold(line);
      }
      const padded = padVisible(line, width);
      return isSelected ? this.theme.bg("selectedBg", padded) : padded;
    });

    return this.fillHeight(lines, width, height);
  }

  private renderPreviewPane(width: number, height: number): string[] {
    const entry = this.getSelectedEntry();
    const allLines = buildPreviewLines(this.theme, entry, width);
    const maxScroll = Math.max(0, allLines.length - height);
    this.previewScroll = Math.max(0, Math.min(this.previewScroll, maxScroll));
    const visible = allLines
      .slice(this.previewScroll, this.previewScroll + height)
      .map((line) => padVisible(line, width));
    return this.fillHeight(visible, width, height);
  }

  private fillHeight(lines: string[], width: number, height: number): string[] {
    const next = [...lines];
    while (next.length < height) next.push(" ".repeat(width));
    return next.slice(0, height);
  }

  private getFilterSummary(): string {
    const query = normalizeText(this.filterInput.getValue());
    const queryLabel = query ? `query:${query}` : `${FILTER_INPUT_HINT}:off`;
    const projectLabel = this.currentProject
      ? `project:${this.currentProjectFilterEnabled ? this.currentProject : "all"}`
      : "project:none";
    return `${projectLabel} • ${queryLabel}`;
  }

  handleInput(data: string): void {
    this.syncFocusableChildren();

    if (this.queryFocus === "input") {
      if (matchesKey(data, Key.ctrl("f"))) {
        this.blurFilterInput();
        this.requestRender();
        return;
      }
      this.filterInput.handleInput(data);
      this.refreshFilters();
      this.requestRender();
      return;
    }

    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl("c")) ||
      data === "q"
    ) {
      this.pendingG = false;
      this.onClose(this.buildMarkedEntriesPayload());
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
      this.focusPane = this.focusPane === "list" ? "preview" : "list";
      this.requestRender();
      return;
    }

    if (matchesKey(data, Key.enter)) {
      this.focusPane = this.focusPane === "list" ? "preview" : "list";
      this.requestRender();
      return;
    }

    if (data === "p") {
      this.toggleCurrentProjectFilter();
      this.requestRender();
      return;
    }

    if (data === "t") {
      this.toggleSplitMode();
      this.requestRender();
      return;
    }

    if (data === "r") {
      void this.reload();
      return;
    }

    if (data === "e") {
      const entry = this.getSelectedEntry();
      if (entry) {
        void this.onEdit(entry.path);
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
    else if (matchesKey(data, Key.home)) this.moveSelection(-9999);
    else if (matchesKey(data, Key.end)) this.moveSelection(9999);
    else return;

    this.requestRender();
  }

  render(width: number): string[] {
    this.syncFocusableChildren();

    const contentWidth = Math.max(CONTENT_MIN_WIDTH, width - 2);
    const bodyHeight = this.getBodyHeight();
    const isPreviewFocused = this.focusPane === "preview";
    const isVerticalSplit = !isPreviewFocused && this.splitMode === "vertical";
    const leftWidth = isPreviewFocused
      ? 0
      : isVerticalSplit
        ? contentWidth
        : Math.max(
            LIST_MIN_WIDTH,
            Math.min(
              LIST_MAX_WIDTH,
              Math.floor(contentWidth * LIST_WIDTH_RATIO),
            ),
          );
    const rightWidth = isPreviewFocused
      ? Math.max(PREVIEW_MIN_WIDTH, contentWidth - PREVIEW_ONLY_WIDTH_OFFSET)
      : isVerticalSplit
        ? contentWidth
        : Math.max(PREVIEW_MIN_WIDTH, contentWidth - leftWidth - DIVIDER_WIDTH);
    const listHeight = this.getListPaneHeight(bodyHeight);
    const previewHeight = isPreviewFocused
      ? bodyHeight
      : isVerticalSplit
        ? bodyHeight - listHeight - 1
        : bodyHeight;
    const selected = this.getSelectedEntry();

    const borderFg = (text: string) => this.theme.fg(FRAME_COLOR, text);
    const title = this.theme.bold(" Agent Journal ");
    const focusLabel =
      this.focusPane === "list"
        ? this.theme.fg("accent", "[list]")
        : this.theme.fg("accent", "[preview]");
    const subtitle = this.theme.fg(
      "dim",
      `${formatHomePath(this.journalRoot)} • ${this.filteredEntries.length}/${this.entries.length} shown • newest first • layout:${this.splitMode}`,
    );

    const queryValue = this.filterInput.getValue();
    const queryDisplay = queryValue || FILTER_INPUT_HINT;
    const queryPrefix = `${FILTER_INPUT_LABEL}: `;
    const queryLine =
      this.queryFocus === "input"
        ? `${queryPrefix}${this.filterInput.render(Math.max(8, contentWidth - queryPrefix.length))[0] ?? ""}`
        : `${queryPrefix}${this.theme.fg(queryValue ? "text" : "muted", queryDisplay)}`;
    const selectedLine = selected
      ? `${this.theme.fg(this.markedPaths.has(selected.path) ? "success" : "muted", this.markedPaths.has(selected.path) ? "☑" : "☐")} ${this.theme.fg("muted", `${selected.metadata.date} ${selected.metadata.title}`)}`
      : this.theme.fg("muted", "☐ none");
    const filterSummary = this.theme.fg("dim", this.getFilterSummary());

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
      frameLine(subtitle),
      frameLine(queryLine),
      frameLine(filterSummary),
      frameLine(selectedLine),
      makeDividerLine(),
    ];

    const left = isPreviewFocused
      ? []
      : this.renderListPane(leftWidth, listHeight);
    const right = this.renderPreviewPane(
      rightWidth,
      Math.max(0, previewHeight),
    );
    const body: string[] = [];

    if (isPreviewFocused) {
      for (let i = 0; i < bodyHeight; i += 1) {
        body.push(frameLine(padVisible(right[i] ?? "", contentWidth)));
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
      "/ or ctrl-f filter • p project • t layout • enter/tab preview • m mark • e edit • r rescan • q/esc close";
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

  invalidate(): void {
    this.filterInput.invalidate();
    this.syncFocusableChildren();
  }
}

export default function agentJournalExtension(pi: ExtensionAPI) {
  pi.registerCommand(COMMAND_NAME, {
    description: "Browse ~/org/agent-journal with preview and quick filters",
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

      const currentProject = detectCurrentProject(ctx.cwd);

      const markedEntries = await ctx.ui.custom<
        MarkedEntriesPayload | undefined
      >(
        (tui, theme, _kb, done) => {
          const openEditor = async (filePath: string) => {
            const editorCmd = process.env.VISUAL || process.env.EDITOR;
            if (!editorCmd) {
              ctx.ui.notify(
                "Set $VISUAL or $EDITOR to edit journal entries",
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

          const component = new AgentJournalComponent(
            JOURNAL_ROOT,
            currentProject,
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
            width: "82%",
            minWidth: OVERLAY_MIN_WIDTH,
            maxHeight: OVERLAY_MAX_HEIGHT,
            margin: OVERLAY_MARGIN,
          },
        },
      );

      if (markedEntries) {
        ctx.ui.setEditorText(markedEntries.text);
        ctx.ui.notify(
          `Loaded ${markedEntries.count} marked journal entr${markedEntries.count === 1 ? "y" : "ies"} into the editor`,
          "info",
        );
      }
    },
  });
}
