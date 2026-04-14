import {
  type ExtensionAPI,
  type ExtensionContext,
  type SessionEntry,
  type Theme,
} from "@mariozechner/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type NoteStatus = "TODO" | "DONE";

type SessionNote = {
  id: string;
  title: string;
  body: string;
  status: NoteStatus;
  createdAt: number;
  updatedAt: number;
};

type SessionNotesState = {
  notes?: SessionNote[];
  // Legacy compatibility from initial single-note version.
  text?: string;
  updatedAt?: number;
};

type SessionNotesEntry = SessionEntry & {
  type: "custom";
  customType?: string;
  data?: SessionNotesState;
};

type MarkedNotesPayload = {
  count: number;
  text: string;
};

type NoteDraft = {
  title: string;
  body: string;
};

const COMMAND_NAME = "session-notes";
const SESSION_NOTES_TYPE = "session-notes";
const STATUS_KEY = "session-notes";
const OVERLAY_MAX_HEIGHT = "88%";
const OVERLAY_MAX_HEIGHT_RATIO = 0.88;
const OVERLAY_MIN_WIDTH = 44;
const OVERLAY_MARGIN = 1;
const MIN_TERMINAL_COLUMNS = OVERLAY_MIN_WIDTH + OVERLAY_MARGIN * 2;
const FRAME_HEADER_HEIGHT = 6;
const FRAME_FOOTER_HEIGHT = 3;
const FRAME_CHROME_HEIGHT = FRAME_HEADER_HEIGHT + FRAME_FOOTER_HEIGHT;
const HEIGHT_SAFETY_MARGIN = 1;
const BODY_MIN_HEIGHT = 10;
const CONTENT_MIN_WIDTH = 40;
const FRAME_COLOR = "muted";
const LIST_WIDTH_RATIO = 0.42;
const LIST_MIN_WIDTH = 24;
const LIST_MAX_WIDTH = 52;
const PREVIEW_MIN_WIDTH = 24;
const DIVIDER_WIDTH = 3;
const VERTICAL_LIST_HEIGHT_RATIO = 0.45;
const VERTICAL_LIST_MIN_HEIGHT = 6;
const VERTICAL_PREVIEW_MIN_HEIGHT = 6;
const HORIZONTAL_SPLIT_MIN_CONTENT_WIDTH =
  LIST_MIN_WIDTH + DIVIDER_WIDTH + PREVIEW_MIN_WIDTH;

type FocusPane = "list" | "preview";
type SplitMode = "horizontal" | "vertical";

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function normalizeNote(note: SessionNote): SessionNote {
  return {
    ...note,
    title: normalizeText(note.title) || "Untitled",
    body: normalizeText(note.body),
    status: note.status === "DONE" ? "DONE" : "TODO",
  };
}

function normalizeNotes(notes: SessionNote[]): SessionNote[] {
  return notes
    .map(normalizeNote)
    .sort(
      (a, b) =>
        (a.status === "DONE" ? 1 : 0) - (b.status === "DONE" ? 1 : 0) ||
        b.updatedAt - a.updatedAt ||
        a.title.localeCompare(b.title),
    );
}

function parseLegacySingleNote(
  data: SessionNotesState | undefined,
): SessionNote[] {
  const text = typeof data?.text === "string" ? normalizeText(data.text) : "";
  if (!text) return [];

  return [
    {
      id: "legacy-single-note",
      title: "Legacy note",
      body: text,
      status: "TODO" as NoteStatus,
      createdAt: data?.updatedAt ?? Date.now(),
      updatedAt: data?.updatedAt ?? Date.now(),
    },
  ];
}

function parseStoredNotes(data: SessionNotesState | undefined): SessionNote[] {
  if (!Array.isArray(data?.notes)) {
    return parseLegacySingleNote(data);
  }

  const parsed: SessionNote[] = [];
  for (const maybeNote of data.notes) {
    if (!maybeNote || typeof maybeNote !== "object") continue;
    const note = maybeNote as Partial<SessionNote>;
    if (typeof note.id !== "string" || !note.id.trim()) continue;
    if (typeof note.title !== "string") continue;
    if (typeof note.body !== "string") continue;

    const createdAt =
      typeof note.createdAt === "number" && Number.isFinite(note.createdAt)
        ? note.createdAt
        : Date.now();
    const updatedAt =
      typeof note.updatedAt === "number" && Number.isFinite(note.updatedAt)
        ? note.updatedAt
        : createdAt;

    const status: NoteStatus = note.status === "DONE" ? "DONE" : "TODO";

    parsed.push({
      id: note.id,
      title: note.title,
      body: note.body,
      status,
      createdAt,
      updatedAt,
    });
  }

  return normalizeNotes(parsed);
}

function getStoredSessionNotes(branch: SessionEntry[]): SessionNote[] {
  let notes: SessionNote[] = [];

  for (const entry of branch) {
    const customEntry = entry as SessionNotesEntry;
    if (customEntry.type !== "custom") continue;
    if (customEntry.customType !== SESSION_NOTES_TYPE) continue;
    notes = parseStoredNotes(customEntry.data);
  }

  return notes;
}

function formatTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  const hh = `${d.getHours()}`.padStart(2, "0");
  const mm = `${d.getMinutes()}`.padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function formatMarkedNotesEditorText(notes: SessionNote[]): string {
  const blocks = notes.map((note) => {
    const heading = `## [${note.status}] ${note.title}`;
    const body = note.body || "(empty)";
    const updated = formatTimestamp(note.updatedAt);
    const meta = updated ? `_updated: ${updated}_\n` : "";
    return `${heading}\n${meta}\n${body}`;
  });

  return `# session notes\n\n${blocks.join("\n\n---\n\n")}\n`;
}

function buildStatusText(notes: SessionNote[]): string | undefined {
  if (notes.length === 0) return undefined;
  return `📝 ${notes.length}`;
}

function applyStatus(ctx: ExtensionContext, notes: SessionNote[]): void {
  ctx.ui.setStatus(STATUS_KEY, buildStatusText(notes));
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

function noteToEditorBuffer(note: SessionNote | undefined): string {
  if (!note) return "# Untitled\n\n";
  return `# ${note.title}\n\n${note.body}\n`;
}

function parseNoteDraftFromEditor(text: string): NoteDraft | undefined {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return undefined;

  const lines = normalized.split("\n");
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex < 0) return undefined;

  const rawTitleLine = lines[firstContentIndex] ?? "";
  const title = normalizeText(rawTitleLine.replace(/^#\s*/, "")) || "Untitled";
  const body = normalizeText(lines.slice(firstContentIndex + 1).join("\n"));

  return { title, body };
}

async function editNoteInExternalEditor(
  editorCommand: string,
  note: SessionNote | undefined,
): Promise<{ ok: true; draft?: NoteDraft } | { ok: false; message: string }> {
  const [editor, ...editorArgs] = editorCommand.split(" ");
  if (!editor) {
    return { ok: false, message: "Invalid editor command" };
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-session-note-"));
  const tempPath = path.join(tempDir, "note.md");

  try {
    await writeFile(tempPath, noteToEditorBuffer(note), "utf8");
    const result = spawnSync(editor, [...editorArgs, tempPath], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    if (result.status && result.status !== 0) {
      return { ok: false, message: `Editor exited with code ${result.status}` };
    }

    const edited = await readFile(tempPath, "utf8");
    return { ok: true, draft: parseNoteDraftFromEditor(edited) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

class SessionNotesComponent {
  private notes: SessionNote[] = [];
  private selectedId?: string;
  private listScroll = 0;
  private previewScroll = 0;
  private focusPane: FocusPane = "list";
  private splitMode: SplitMode = "horizontal";
  private markedIds = new Set<string>();

  constructor(
    initialNotes: SessionNote[],
    private theme: Theme,
    private requestRender: (full?: boolean) => void,
    private onClose: (payload?: MarkedNotesPayload) => void,
    private onCreate: () => Promise<void>,
    private onEdit: (note: SessionNote) => Promise<void>,
    private onDeleteMarked: (notes: SessionNote[]) => Promise<void>,
    private onToggleStatus: (note: SessionNote) => void,
  ) {
    const termWidth = process.stdout.columns ?? 0;
    if (
      termWidth > 0 &&
      this.getContentWidth(termWidth) < HORIZONTAL_SPLIT_MIN_CONTENT_WIDTH
    ) {
      this.splitMode = "vertical";
    }
    this.setNotes(initialNotes);
  }

  setNotes(next: SessionNote[]): void {
    this.notes = normalizeNotes(next);

    if (this.notes.length === 0) {
      this.selectedId = undefined;
      this.listScroll = 0;
      this.previewScroll = 0;
      this.markedIds.clear();
      return;
    }

    const stillSelected = this.notes.some(
      (note) => note.id === this.selectedId,
    );
    if (!stillSelected) {
      this.selectedId = this.notes[0]?.id;
      this.previewScroll = 0;
    }

    const byId = new Set(this.notes.map((note) => note.id));
    for (const id of this.markedIds) {
      if (!byId.has(id)) this.markedIds.delete(id);
    }

    this.clampListSelectionIntoView(
      this.getListPaneHeight(this.getBodyHeight()),
    );
  }

  private getSelectedIndex(): number {
    const index = this.notes.findIndex((note) => note.id === this.selectedId);
    return index >= 0 ? index : 0;
  }

  private getSelectedNote(): SessionNote | undefined {
    return this.notes[this.getSelectedIndex()];
  }

  private moveSelection(delta: number): void {
    if (this.notes.length === 0) return;

    const nextIndex = Math.max(
      0,
      Math.min(this.notes.length - 1, this.getSelectedIndex() + delta),
    );
    this.selectedId = this.notes[nextIndex]?.id;
    this.previewScroll = 0;
    this.clampListSelectionIntoView(
      this.getListPaneHeight(this.getBodyHeight()),
    );
  }

  private getBodyHeight(): number {
    const rows = process.stdout.rows ?? 30;
    const maxOverlayHeight = Math.floor(rows * OVERLAY_MAX_HEIGHT_RATIO);
    return Math.max(
      BODY_MIN_HEIGHT,
      maxOverlayHeight - FRAME_CHROME_HEIGHT - HEIGHT_SAFETY_MARGIN,
    );
  }

  private getContentWidth(width: number): number {
    return Math.max(CONTENT_MIN_WIDTH, width - 2);
  }

  private clampListSelectionIntoView(height: number): void {
    if (this.notes.length === 0) {
      this.selectedId = undefined;
      this.listScroll = 0;
      return;
    }

    if (
      !this.selectedId ||
      !this.notes.some((note) => note.id === this.selectedId)
    ) {
      this.selectedId = this.notes[0]?.id;
    }

    const index = this.getSelectedIndex();
    if (index < this.listScroll) this.listScroll = index;
    else if (index >= this.listScroll + height)
      this.listScroll = index - height + 1;

    const maxScroll = Math.max(0, this.notes.length - height);
    this.listScroll = Math.max(0, Math.min(this.listScroll, maxScroll));
  }

  private toggleMarkForSelected(): void {
    const selected = this.getSelectedNote();
    if (!selected) return;

    if (this.markedIds.has(selected.id)) this.markedIds.delete(selected.id);
    else this.markedIds.add(selected.id);
  }

  private buildMarkedPayload(): MarkedNotesPayload | undefined {
    if (this.markedIds.size === 0) return undefined;

    const notes = this.notes
      .filter((note) => this.markedIds.has(note.id))
      .sort(
        (a, b) =>
          (a.status === "DONE" ? 1 : 0) - (b.status === "DONE" ? 1 : 0) ||
          b.updatedAt - a.updatedAt ||
          a.title.localeCompare(b.title),
      );

    if (notes.length === 0) return undefined;

    return {
      count: notes.length,
      text: formatMarkedNotesEditorText(notes),
    };
  }

  private toggleSplitMode(): void {
    this.splitMode =
      this.splitMode === "horizontal" ? "vertical" : "horizontal";
    this.clampListSelectionIntoView(
      this.getListPaneHeight(this.getBodyHeight()),
    );
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
    if (this.focusPane === "preview") return bodyHeight;
    if (splitMode === "horizontal") return bodyHeight;
    const candidate = Math.floor(bodyHeight * VERTICAL_LIST_HEIGHT_RATIO);
    const minListHeight = Math.min(
      VERTICAL_LIST_MIN_HEIGHT,
      Math.max(1, bodyHeight - VERTICAL_PREVIEW_MIN_HEIGHT - 1),
    );
    return Math.max(minListHeight, candidate);
  }

  private getListPaneWidth(contentWidth: number): number {
    return Math.max(
      LIST_MIN_WIDTH,
      Math.min(LIST_MAX_WIDTH, Math.floor(contentWidth * LIST_WIDTH_RATIO)),
    );
  }

  private getPreviewLines(width: number): string[] {
    const selected = this.getSelectedNote();
    if (!selected) {
      return wrapBlock(
        this.theme.fg(
          "muted",
          "No notes yet. Press a to create one with your external editor.",
        ),
        width,
      );
    }

    const lines: string[] = [];
    const statusTag =
      selected.status === "DONE"
        ? this.theme.fg("success", "DONE")
        : this.theme.fg("error", "TODO");
    lines.push(
      ...wrapBlock(
        `${statusTag} ${this.theme.fg("accent", this.theme.bold(selected.title))}`,
        width,
      ),
    );
    lines.push(
      ...wrapBlock(
        this.theme.fg("dim", `Updated: ${formatTimestamp(selected.updatedAt)}`),
        width,
      ),
    );
    lines.push("");

    if (selected.body) lines.push(...wrapBlock(selected.body, width));
    else
      lines.push(
        ...wrapBlock(this.theme.fg("muted", "(empty note body)"), width),
      );

    return lines;
  }

  private renderListPane(width: number, height: number): string[] {
    this.clampListSelectionIntoView(height);

    if (this.notes.length === 0) {
      const empty = wrapBlock(this.theme.fg("muted", "No notes"), width);
      while (empty.length < height) empty.push(" ".repeat(width));
      return empty.slice(0, height);
    }

    const slice = this.notes.slice(this.listScroll, this.listScroll + height);
    const lines = slice.map((note) => {
      const isSelected = note.id === this.selectedId;
      const isMarked = this.markedIds.has(note.id);
      const mark = isMarked
        ? this.theme.fg("success", "☑")
        : this.theme.fg("muted", "☐");
      const statusTag =
        note.status === "DONE"
          ? this.theme.fg("success", "DONE")
          : this.theme.fg("error", "TODO");
      let text = `${mark} ${statusTag} ${note.title} ${this.theme.fg("dim", `(${formatTimestamp(note.updatedAt)})`)}`;
      if (isMarked) text = this.theme.bold(text);
      const padded = padVisible(text, width);
      return isSelected ? this.theme.bg("selectedBg", padded) : padded;
    });

    while (lines.length < height) lines.push(" ".repeat(width));
    return lines;
  }

  private renderPreviewPane(width: number, height: number): string[] {
    const allLines = this.getPreviewLines(width);
    const maxScroll = Math.max(0, allLines.length - height);
    this.previewScroll = Math.max(0, Math.min(this.previewScroll, maxScroll));

    const visible = allLines
      .slice(this.previewScroll, this.previewScroll + height)
      .map((line) => padVisible(line, width));

    while (visible.length < height) visible.push(" ".repeat(width));
    return visible;
  }

  handleInput(data: string): void {
    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl("c")) ||
      data === "q"
    ) {
      this.onClose(this.buildMarkedPayload());
      return;
    }

    if (data === "a") {
      void this.onCreate();
      return;
    }

    if (data === "m") {
      this.toggleMarkForSelected();
      this.requestRender();
      return;
    }

    const selected = this.getSelectedNote();

    if (data === "e") {
      if (selected) void this.onEdit(selected);
      return;
    }

    if (data === "x") {
      const markedNotes = this.notes.filter((n) => this.markedIds.has(n.id));
      if (markedNotes.length > 0) void this.onDeleteMarked(markedNotes);
      return;
    }

    if (data === "s") {
      if (selected) {
        this.onToggleStatus(selected);
        this.requestRender();
      }
      return;
    }

    if (data === "t") {
      this.toggleSplitMode();
      this.requestRender();
      return;
    }

    if (matchesKey(data, Key.enter) || matchesKey(data, Key.tab)) {
      this.focusPane = this.focusPane === "list" ? "preview" : "list";
      this.requestRender();
      return;
    }

    const page = Math.max(4, Math.floor(this.getBodyHeight() * 0.8));

    if (this.focusPane === "preview") {
      if (matchesKey(data, Key.up) || data === "k") this.previewScroll -= 1;
      else if (matchesKey(data, Key.down) || data === "j")
        this.previewScroll += 1;
      else if (matchesKey(data, Key.ctrl("u")) || matchesKey(data, "pageUp"))
        this.previewScroll -= page;
      else if (matchesKey(data, Key.ctrl("d")) || matchesKey(data, "pageDown"))
        this.previewScroll += page;
      else if (matchesKey(data, Key.home) || data === "g")
        this.previewScroll = 0;
      else if (matchesKey(data, Key.end) || data === "G")
        this.previewScroll = Number.MAX_SAFE_INTEGER;
      else return;

      this.requestRender();
      return;
    }

    if (matchesKey(data, Key.up) || data === "k") this.moveSelection(-1);
    else if (matchesKey(data, Key.down) || data === "j") this.moveSelection(1);
    else if (matchesKey(data, "pageUp")) this.moveSelection(-page);
    else if (matchesKey(data, "pageDown")) this.moveSelection(page);
    else if (matchesKey(data, Key.home) || data === "g")
      this.moveSelection(-9999);
    else if (matchesKey(data, Key.end) || data === "G")
      this.moveSelection(9999);
    else return;

    this.requestRender();
  }

  render(width: number): string[] {
    const contentWidth = this.getContentWidth(width);
    const bodyHeight = this.getBodyHeight();

    const effectiveSplitMode = this.getEffectiveSplitMode(width);
    const isPreviewFocused = this.focusPane === "preview";
    const isVerticalSplit =
      !isPreviewFocused && effectiveSplitMode === "vertical";

    const listWidth = isPreviewFocused
      ? 0
      : isVerticalSplit
        ? contentWidth
        : this.getListPaneWidth(contentWidth);
    const previewWidth = isPreviewFocused
      ? contentWidth
      : isVerticalSplit
        ? contentWidth
        : Math.max(PREVIEW_MIN_WIDTH, contentWidth - listWidth - DIVIDER_WIDTH);
    const listHeight = this.getListPaneHeight(bodyHeight, effectiveSplitMode);
    const previewHeight = isPreviewFocused
      ? bodyHeight
      : isVerticalSplit
        ? bodyHeight - listHeight - 1
        : bodyHeight;

    const borderFg = (text: string) => this.theme.fg(FRAME_COLOR, text);
    const frameLine = (content: string) =>
      `${borderFg("┃")}${padVisible(content, contentWidth)}${borderFg("┃")}`;

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

    const selected = this.getSelectedNote();
    const selectedStatusTag = selected
      ? selected.status === "DONE"
        ? this.theme.fg("success", "DONE")
        : this.theme.fg("error", "TODO")
      : "";
    const selectedLine = selected
      ? `${this.theme.fg(this.markedIds.has(selected.id) ? "success" : "muted", this.markedIds.has(selected.id) ? "☑" : "☐")} ${selectedStatusTag} ${this.theme.fg("muted", selected.title)}`
      : this.theme.fg("muted", "☐ none");

    const header = [
      makeBorderLine("┏", "━", "┓", this.theme.bold(" Session Notes ")),
      frameLine(
        this.theme.fg(
          "dim",
          `${this.notes.length} note(s) • marked: ${this.markedIds.size} • focus:${this.focusPane} • layout:${effectiveSplitMode}${effectiveSplitMode !== this.splitMode ? " (auto)" : ""}`,
        ),
      ),
      frameLine(
        this.theme.fg(
          "dim",
          "Stored as custom session entries (not sent to the LLM context)",
        ),
      ),
      frameLine(selectedLine),
      makeDividerLine(),
    ];

    const body: string[] = [];

    if (isPreviewFocused) {
      const preview = this.renderPreviewPane(previewWidth, bodyHeight);
      for (let i = 0; i < bodyHeight; i += 1) {
        body.push(frameLine(preview[i] ?? ""));
      }
    } else if (isVerticalSplit) {
      const left = this.renderListPane(contentWidth, listHeight);
      const right = this.renderPreviewPane(
        contentWidth,
        Math.max(0, previewHeight),
      );
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
      const left = this.renderListPane(listWidth, bodyHeight);
      const right = this.renderPreviewPane(previewWidth, bodyHeight);
      for (let i = 0; i < bodyHeight; i += 1) {
        const line = `${padVisible(left[i] ?? "", listWidth)}${this.theme.fg("borderMuted", " │ ")}${padVisible(right[i] ?? "", previewWidth)}`;
        body.push(frameLine(line));
      }
    }

    const footer = [
      makeDividerLine(),
      frameLine(
        this.theme.fg(
          "dim",
          "a add • e edit • m mark • x del marked • s status • t layout • enter/tab preview • j/k scroll • q/esc close",
        ),
      ),
      makeBorderLine("┗", "━", "┛"),
    ];

    return [...header, ...body, ...footer];
  }

  invalidate(): void {}
}

export default function sessionNotesExtension(pi: ExtensionAPI) {
  const refreshStatus = (ctx: ExtensionContext) => {
    applyStatus(ctx, getStoredSessionNotes(ctx.sessionManager.getBranch()));
  };

  pi.on("session_start", async (_event, ctx) => {
    refreshStatus(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    refreshStatus(ctx);
  });

  pi.registerCommand(COMMAND_NAME, {
    description:
      "Manage transient per-session notes and load marked notes into the editor",
    handler: async (args, ctx) => {
      let notes = getStoredSessionNotes(ctx.sessionManager.getBranch());

      const persist = (nextNotes: SessionNote[]) => {
        notes = normalizeNotes(nextNotes);
        pi.appendEntry(SESSION_NOTES_TYPE, {
          notes,
        } satisfies SessionNotesState);
        applyStatus(ctx, notes);
      };

      const inlineText = normalizeText(args ?? "");
      if (inlineText) {
        const now = Date.now();
        const title = truncateToWidth(inlineText, 50) || "Quick note";
        const next: SessionNote = {
          id: randomUUID(),
          title,
          body: inlineText,
          status: "TODO",
          createdAt: now,
          updatedAt: now,
        };
        persist([next, ...notes]);
        ctx.ui.notify("Created quick session note", "success");
        return;
      }

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

      const marked = await ctx.ui.custom<MarkedNotesPayload | undefined>(
        (tui, theme, _kb, done) => {
          const withEditor = async (
            existing: SessionNote | undefined,
            onSave: (draft: NoteDraft | undefined) => void,
          ) => {
            const editorCmd = process.env.VISUAL || process.env.EDITOR;
            if (!editorCmd) {
              ctx.ui.notify(
                "Set $VISUAL or $EDITOR to edit session notes",
                "warning",
              );
              return;
            }

            tui.stop();
            const result = await editNoteInExternalEditor(editorCmd, existing);
            tui.start();

            if (!result.ok) {
              ctx.ui.notify(
                `Failed to edit session note: ${result.message}`,
                "error",
              );
              tui.requestRender(true);
              return;
            }

            onSave(result.draft);
            component.setNotes(notes);
            tui.requestRender(true);
          };

          const component = new SessionNotesComponent(
            notes,
            theme,
            (full) => tui.requestRender(Boolean(full)),
            (payload) => done(payload),
            async () => {
              await withEditor(undefined, (draft) => {
                if (!draft) {
                  ctx.ui.notify("New note discarded (empty)", "info");
                  return;
                }
                const now = Date.now();
                const next: SessionNote = {
                  id: randomUUID(),
                  title: draft.title,
                  body: draft.body,
                  status: "TODO",
                  createdAt: now,
                  updatedAt: now,
                };
                persist([next, ...notes]);
                ctx.ui.notify("Created session note", "success");
              });
            },
            async (note) => {
              await withEditor(note, (draft) => {
                if (!draft) {
                  ctx.ui.notify("Edit discarded (empty)", "info");
                  return;
                }

                persist(
                  notes.map((n) =>
                    n.id === note.id
                      ? {
                          ...n,
                          title: draft.title,
                          body: draft.body,
                          updatedAt: Date.now(),
                        }
                      : n,
                  ),
                );
                ctx.ui.notify("Saved session note", "success");
              });
            },
            async (markedNotes) => {
              const idsToDelete = new Set(markedNotes.map((n) => n.id));
              persist(notes.filter((n) => !idsToDelete.has(n.id)));
              component.setNotes(notes);
              ctx.ui.notify(
                `Deleted ${markedNotes.length} session note${markedNotes.length === 1 ? "" : "s"}`,
                "info",
              );
              tui.requestRender(true);
            },
            (note) => {
              const nextStatus: NoteStatus =
                note.status === "DONE" ? "TODO" : "DONE";
              persist(
                notes.map((n) =>
                  n.id === note.id ? { ...n, status: nextStatus } : n,
                ),
              );
              component.setNotes(notes);
            },
          );

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

      if (marked) {
        ctx.ui.setEditorText(marked.text);
        ctx.ui.notify(
          `Loaded ${marked.count} marked note${marked.count === 1 ? "" : "s"} into the editor`,
          "info",
        );
      }
    },
  });
}
