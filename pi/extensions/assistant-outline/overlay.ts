import { getMarkdownTheme, type Theme } from "@mariozechner/pi-coding-agent";
import {
  Key,
  Markdown,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@mariozechner/pi-tui";
import { buildExportedSectionsPayload } from "./comments";
import {
  flattenVisibleOutline,
  getNodeMarkdown,
  getNodePath,
} from "./markdown-outline";
import type {
  ExportedSectionsPayload,
  OutlineNode,
  OutlineRow,
  ParsedAssistantOutline,
  SectionComments,
} from "./types";

type FocusPane = "outline" | "preview";
type SplitMode = "horizontal" | "vertical";

type OverlayCallbacks = {
  requestRender: (full?: boolean) => void;
  onClose: (payload?: ExportedSectionsPayload) => void;
  onReload: () => Promise<{
    document?: ParsedAssistantOutline;
    timestamp?: number;
    error?: string;
  }>;
  onEditComment: (node: OutlineNode) => Promise<void>;
  getComments: () => SectionComments;
};

const OVERLAY_MAX_HEIGHT_RATIO = 0.9;
const OVERLAY_MIN_WIDTH = 42;
const OVERLAY_MARGIN = 1;
export const MIN_TERMINAL_COLUMNS = OVERLAY_MIN_WIDTH + OVERLAY_MARGIN * 2;
export const OVERLAY_OPTIONS = {
  anchor: "center" as const,
  width: "84%",
  minWidth: OVERLAY_MIN_WIDTH,
  maxHeight: "90%",
  margin: OVERLAY_MARGIN,
};
const FRAME_COLOR = "muted";
const FRAME_HEADER_HEIGHT = 6;
const FRAME_FOOTER_HEIGHT = 3;
const FRAME_CHROME_HEIGHT = FRAME_HEADER_HEIGHT + FRAME_FOOTER_HEIGHT;
const HEIGHT_SAFETY_MARGIN = 1;
const BODY_MIN_HEIGHT = 10;
const CONTENT_MIN_WIDTH = 40;
const DIVIDER_WIDTH = 3;
const OUTLINE_WIDTH_RATIO = 0.38;
const OUTLINE_MIN_WIDTH = 24;
const OUTLINE_MAX_WIDTH = 50;
const PREVIEW_MIN_WIDTH = 28;
const HORIZONTAL_SPLIT_MIN_CONTENT_WIDTH =
  OUTLINE_MIN_WIDTH + DIVIDER_WIDTH + PREVIEW_MIN_WIDTH;
const VERTICAL_OUTLINE_HEIGHT_RATIO = 0.42;
const VERTICAL_OUTLINE_MIN_HEIGHT = 6;
const VERTICAL_PREVIEW_MIN_HEIGHT = 6;

function padVisible(text: string, width: number): string {
  const truncated = truncateToWidth(text, width);
  const missing = Math.max(0, width - visibleWidth(truncated));
  return truncated + " ".repeat(missing);
}

function formatTimestamp(timestamp?: number): string {
  if (!timestamp) return "unknown time";
  const date = new Date(timestamp);
  return Number.isNaN(date.valueOf()) ? "unknown time" : date.toLocaleString();
}

function buildPreviewLines(
  theme: Theme,
  document: ParsedAssistantOutline,
  node: OutlineNode,
  comments: SectionComments,
  width: number,
): string[] {
  const pathLabel = getNodePath(document, node.id).join(" > ");
  const comment = comments[node.id]?.trim();
  const markdownText = getNodeMarkdown(document, node);
  const lines: string[] = [];

  lines.push(theme.fg("accent", theme.bold(pathLabel)));
  lines.push(
    theme.fg(
      "dim",
      `lines ${node.startLine + 1}-${Math.max(node.startLine + 1, node.endLine)}`,
    ),
  );
  if (comment) {
    lines.push("");
    lines.push(theme.fg("success", theme.bold("Comment")));
    lines.push(...comment.split(/\r?\n/));
  }
  if (markdownText) {
    if (lines.length > 0) lines.push("");
    const markdown = new Markdown(markdownText, 0, 0, getMarkdownTheme());
    lines.push(...markdown.render(Math.max(1, width)));
  }
  if (!markdownText) {
    lines.push("");
    lines.push(theme.fg("muted", "(section is empty)"));
  }
  return lines;
}

export class AssistantOutlineOverlay {
  private document?: ParsedAssistantOutline;
  private messageTimestamp?: number;
  private loading = true;
  private error?: string;
  private focusPane: FocusPane = "outline";
  private splitMode: SplitMode = "horizontal";
  private selectedId = "root";
  private outlineScroll = 0;
  private previewScroll = 0;
  private pendingG = false;
  private markedIds = new Set<string>();
  private expanded = new Set<string>(["root"]);

  constructor(
    private theme: Theme,
    private callbacks: OverlayCallbacks,
  ) {
    const termWidth = process.stdout.columns ?? 0;
    if (
      termWidth > 0 &&
      this.getContentWidth(termWidth) < HORIZONTAL_SPLIT_MIN_CONTENT_WIDTH
    ) {
      this.splitMode = "vertical";
    }
  }

  async init(): Promise<void> {
    await this.reload();
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

  private getOutlinePaneHeight(
    bodyHeight: number,
    splitMode: SplitMode = this.splitMode,
  ): number {
    if (splitMode === "horizontal") return bodyHeight;

    const candidate = Math.floor(bodyHeight * VERTICAL_OUTLINE_HEIGHT_RATIO);
    const minOutlineHeight = Math.min(
      VERTICAL_OUTLINE_MIN_HEIGHT,
      Math.max(1, bodyHeight - VERTICAL_PREVIEW_MIN_HEIGHT - 1),
    );
    return Math.max(minOutlineHeight, candidate);
  }

  private getVisibleRows(): OutlineRow[] {
    if (!this.document) return [];
    return flattenVisibleOutline(this.document.root, this.expanded);
  }

  private getSelectedRowIndex(rows = this.getVisibleRows()): number {
    const index = rows.findIndex((row) => row.node.id === this.selectedId);
    return index >= 0 ? index : 0;
  }

  private getSelectedNode(): OutlineNode | undefined {
    return this.getVisibleRows()[this.getSelectedRowIndex()]?.node;
  }

  private clampSelectionIntoView(bodyHeight: number): void {
    const rows = this.getVisibleRows();
    if (rows.length === 0) {
      this.selectedId = "root";
      this.outlineScroll = 0;
      return;
    }

    if (!rows.some((row) => row.node.id === this.selectedId)) {
      this.selectedId = rows[0]?.node.id ?? "root";
    }

    const index = this.getSelectedRowIndex(rows);
    if (index < this.outlineScroll) {
      this.outlineScroll = index;
    } else if (index >= this.outlineScroll + bodyHeight) {
      this.outlineScroll = index - bodyHeight + 1;
    }

    const maxScroll = Math.max(0, rows.length - bodyHeight);
    this.outlineScroll = Math.max(0, Math.min(this.outlineScroll, maxScroll));
  }

  private moveSelection(delta: number): void {
    const rows = this.getVisibleRows();
    if (rows.length === 0) return;
    const current = this.getSelectedRowIndex(rows);
    const next = Math.max(0, Math.min(rows.length - 1, current + delta));
    this.selectedId = rows[next]?.node.id ?? this.selectedId;
    this.previewScroll = 0;
    this.clampSelectionIntoView(
      this.getOutlinePaneHeight(this.getBodyHeight()),
    );
  }

  private toggleExpanded(node: OutlineNode | undefined): void {
    if (!node || node.children.length === 0 || node.id === "root") return;
    if (this.expanded.has(node.id)) {
      this.expanded.delete(node.id);
    } else {
      this.expanded.add(node.id);
    }
    this.clampSelectionIntoView(
      this.getOutlinePaneHeight(this.getBodyHeight()),
    );
  }

  private expandSelected(): void {
    const node = this.getSelectedNode();
    if (!node) return;
    if (node.children.length > 0 && !this.expanded.has(node.id)) {
      this.expanded.add(node.id);
      this.clampSelectionIntoView(
        this.getOutlinePaneHeight(this.getBodyHeight()),
      );
      return;
    }

    const rows = this.getVisibleRows();
    const next = rows[this.getSelectedRowIndex(rows) + 1]?.node;
    if (next) {
      this.selectedId = next.id;
      this.previewScroll = 0;
    }
  }

  private collapseSelected(): void {
    const rows = this.getVisibleRows();
    const selected = rows[this.getSelectedRowIndex(rows)];
    if (!selected) return;

    if (selected.node.id !== "root" && this.expanded.has(selected.node.id)) {
      this.expanded.delete(selected.node.id);
      this.clampSelectionIntoView(
        this.getOutlinePaneHeight(this.getBodyHeight()),
      );
      return;
    }

    if (selected.depth <= 0) return;
    for (
      let index = this.getSelectedRowIndex(rows) - 1;
      index >= 0;
      index -= 1
    ) {
      if ((rows[index]?.depth ?? 0) === selected.depth - 1) {
        this.selectedId = rows[index]!.node.id;
        this.previewScroll = 0;
        return;
      }
    }
  }

  private toggleSplitMode(): void {
    this.splitMode =
      this.splitMode === "horizontal" ? "vertical" : "horizontal";
    this.clampSelectionIntoView(
      this.getOutlinePaneHeight(this.getBodyHeight()),
    );
  }

  private toggleMarkedSelected(): void {
    const node = this.getSelectedNode();
    if (!node) return;
    if (this.markedIds.has(node.id)) this.markedIds.delete(node.id);
    else this.markedIds.add(node.id);
  }

  setComment(nodeId: string, comment: string): void {
    if (comment.trim()) {
      this.markedIds.add(nodeId);
    }
    this.callbacks.requestRender(true);
  }

  async reload(): Promise<void> {
    this.loading = true;
    this.error = undefined;
    this.callbacks.requestRender(true);

    const result = await this.callbacks.onReload();
    this.document = result.document;
    this.error = result.error;
    this.loading = false;

    if (!this.document) {
      this.selectedId = "root";
      this.previewScroll = 0;
      this.outlineScroll = 0;
      this.callbacks.requestRender(true);
      return;
    }

    this.expanded = new Set(["root"]);
    const topLevel = this.document.root.children.map((node) => node.id);
    for (const id of topLevel) this.expanded.add(id);
    this.selectedId = this.document.nodesById.has(this.selectedId)
      ? this.selectedId
      : "root";
    this.previewScroll = 0;
    this.outlineScroll = 0;
    this.clampSelectionIntoView(
      this.getOutlinePaneHeight(this.getBodyHeight()),
    );
    this.callbacks.requestRender(true);
  }

  private renderOutlinePane(width: number, height: number): string[] {
    if (this.loading) {
      return this.fillHeight(
        [this.theme.fg("muted", "Loading latest assistant response...")],
        width,
        height,
      );
    }
    if (this.error) {
      return this.fillHeight(
        [this.theme.fg("error", this.error)],
        width,
        height,
      );
    }
    if (!this.document) {
      return this.fillHeight(
        [this.theme.fg("muted", "No assistant response available.")],
        width,
        height,
      );
    }

    const rows = this.getVisibleRows();
    this.clampSelectionIntoView(height);
    const slice = rows.slice(this.outlineScroll, this.outlineScroll + height);
    const comments = this.callbacks.getComments();
    const lines = slice.map((row) => {
      const isSelected = row.node.id === this.selectedId;
      const hasChildren = row.node.children.length > 0;
      const expander = !hasChildren
        ? "·"
        : this.expanded.has(row.node.id)
          ? "▾"
          : "▸";
      const marked = this.markedIds.has(row.node.id) ? "*" : " ";
      const commented = comments[row.node.id]?.trim() ? "+" : " ";
      const indent =
        row.depth === 0 ? "" : "  ".repeat(Math.max(0, row.depth - 1));
      let line = `${indent}${expander} [${marked}${commented}] ${row.node.title}`;
      if (row.node.id === "root") {
        line = this.theme.fg("accent", line);
      }
      const padded = padVisible(line, width);
      return isSelected ? this.theme.bg("selectedBg", padded) : padded;
    });

    return this.fillHeight(lines, width, height);
  }

  private renderPreviewPane(width: number, height: number): string[] {
    if (this.loading) {
      return this.fillHeight(
        [this.theme.fg("muted", "Waiting for assistant response...")],
        width,
        height,
      );
    }
    if (this.error) {
      return this.fillHeight(
        [this.theme.fg("error", this.error)],
        width,
        height,
      );
    }
    if (!this.document) {
      return this.fillHeight(
        [this.theme.fg("muted", "No preview available.")],
        width,
        height,
      );
    }

    const node = this.getSelectedNode() ?? this.document.root;
    const allLines = buildPreviewLines(
      this.theme,
      this.document,
      node,
      this.callbacks.getComments(),
      width,
    );
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

  handleInput(data: string): void {
    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl("c")) ||
      data === "q"
    ) {
      if (this.document) {
        this.callbacks.onClose(
          buildExportedSectionsPayload(
            this.document,
            this.markedIds,
            this.callbacks.getComments(),
          ),
        );
      } else {
        this.callbacks.onClose(undefined);
      }
      return;
    }

    if (data === "g") {
      if (this.pendingG) {
        this.pendingG = false;
        if (this.focusPane === "preview") this.previewScroll = 0;
        else this.moveSelection(-9999);
        this.callbacks.requestRender();
      } else {
        this.pendingG = true;
      }
      return;
    }

    if (data === "G") {
      this.pendingG = false;
      if (this.focusPane === "preview")
        this.previewScroll = Number.MAX_SAFE_INTEGER;
      else this.moveSelection(9999);
      this.callbacks.requestRender();
      return;
    }

    this.pendingG = false;

    if (matchesKey(data, Key.enter)) {
      this.focusPane = this.focusPane === "outline" ? "preview" : "outline";
      this.callbacks.requestRender();
      return;
    }

    if (matchesKey(data, Key.tab)) {
      this.toggleExpanded(this.getSelectedNode());
      this.callbacks.requestRender();
      return;
    }

    if (data === "t") {
      this.toggleSplitMode();
      this.callbacks.requestRender(true);
      return;
    }

    if (data === "m") {
      this.toggleMarkedSelected();
      this.callbacks.requestRender();
      return;
    }

    if (data === "r") {
      void this.reload();
      return;
    }

    if (data === "e") {
      const node = this.getSelectedNode();
      if (node) {
        void this.callbacks.onEditComment(node);
      }
      return;
    }

    const page = Math.max(5, Math.floor(this.getBodyHeight() * 0.8));
    if (matchesKey(data, Key.ctrl("u"))) {
      this.previewScroll -= page;
      this.callbacks.requestRender();
      return;
    }
    if (matchesKey(data, Key.ctrl("d"))) {
      this.previewScroll += page;
      this.callbacks.requestRender();
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
      this.callbacks.requestRender();
      return;
    }

    if (matchesKey(data, Key.up) || data === "k") this.moveSelection(-1);
    else if (matchesKey(data, Key.down) || data === "j") this.moveSelection(1);
    else if (matchesKey(data, "pageUp")) this.moveSelection(-page);
    else if (matchesKey(data, "pageDown")) this.moveSelection(page);
    else if (matchesKey(data, Key.left) || data === "h")
      this.collapseSelected();
    else if (matchesKey(data, Key.right) || data === "l") this.expandSelected();
    else if (matchesKey(data, Key.home)) this.moveSelection(-9999);
    else if (matchesKey(data, Key.end)) this.moveSelection(9999);
    else return;

    this.callbacks.requestRender();
  }

  render(width: number): string[] {
    const contentWidth = this.getContentWidth(width);
    const bodyHeight = this.getBodyHeight();
    const previewOnly = this.focusPane === "preview";
    const effectiveSplitMode = this.getEffectiveSplitMode(width);
    const vertical = !previewOnly && effectiveSplitMode === "vertical";
    const outlineWidth = previewOnly
      ? 0
      : vertical
        ? contentWidth
        : Math.max(
            OUTLINE_MIN_WIDTH,
            Math.min(
              OUTLINE_MAX_WIDTH,
              Math.floor(contentWidth * OUTLINE_WIDTH_RATIO),
            ),
          );
    const previewWidth = previewOnly
      ? contentWidth
      : vertical
        ? contentWidth
        : Math.max(
            PREVIEW_MIN_WIDTH,
            contentWidth - outlineWidth - DIVIDER_WIDTH,
          );
    const outlineHeight = previewOnly
      ? 0
      : vertical
        ? this.getOutlinePaneHeight(bodyHeight, effectiveSplitMode)
        : bodyHeight;
    const previewHeight = previewOnly
      ? bodyHeight
      : vertical
        ? bodyHeight - outlineHeight - 1
        : bodyHeight;

    const borderFg = (text: string) => this.theme.fg(FRAME_COLOR, text);
    const title = this.theme.bold(" Assistant Outline ");
    const focusLabel = this.theme.fg(
      "accent",
      this.focusPane === "outline" ? "[outline]" : "[preview]",
    );
    const subtitle = this.theme.fg(
      "dim",
      this.document
        ? `last assistant response • ${formatTimestamp(this.messageTimestamp)} • marked:${this.markedIds.size} • layout:${effectiveSplitMode}${effectiveSplitMode !== this.splitMode ? " (auto)" : ""}`
        : "last assistant response",
    );
    const selected = this.getSelectedNode();
    const selectionLine =
      selected && this.document
        ? this.theme.fg(
            "muted",
            getNodePath(this.document, selected.id).join(" > "),
          )
        : this.theme.fg("muted", "No section selected");
    const hintLine = this.theme.fg(
      "dim",
      "[*] marked for export • [+] has comment • root shows the whole response",
    );

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
      frameLine(selectionLine),
      frameLine(hintLine),
      makeDividerLine(),
    ];

    const outlineLines = previewOnly
      ? []
      : this.renderOutlinePane(outlineWidth, outlineHeight);
    const previewLines = this.renderPreviewPane(
      previewWidth,
      Math.max(0, previewHeight),
    );
    const body: string[] = [];

    if (previewOnly) {
      for (let index = 0; index < bodyHeight; index += 1) {
        body.push(
          frameLine(padVisible(previewLines[index] ?? "", contentWidth)),
        );
      }
    } else if (vertical) {
      for (let index = 0; index < outlineHeight; index += 1) {
        body.push(
          frameLine(padVisible(outlineLines[index] ?? "", contentWidth)),
        );
      }
      body.push(
        frameLine(this.theme.fg("borderMuted", "─".repeat(contentWidth))),
      );
      for (let index = 0; index < previewHeight; index += 1) {
        body.push(
          frameLine(padVisible(previewLines[index] ?? "", contentWidth)),
        );
      }
    } else {
      for (let index = 0; index < bodyHeight; index += 1) {
        const line = `${padVisible(outlineLines[index] ?? "", outlineWidth)}${this.theme.fg("borderMuted", " │ ")}${padVisible(previewLines[index] ?? "", previewWidth)}`;
        body.push(frameLine(line));
      }
    }

    const footerText =
      "↑/↓ or j/k move • h/l collapse/expand • tab fold • enter preview-only • e comment • m mark • ctrl-u/d page • r reload • t layout • q close";
    const footerExtra = this.error ? ` • error: ${this.error}` : "";
    const footer = [
      makeDividerLine(),
      frameLine(this.theme.fg("dim", footerText + footerExtra)),
      makeBorderLine("┗", "━", "┛"),
    ];

    return [...header, ...body, ...footer];
  }

  invalidate(): void {}

  setLoadedDocument(
    document: ParsedAssistantOutline | undefined,
    timestamp?: number,
  ): void {
    this.document = document;
    this.messageTimestamp = timestamp;
  }
}
