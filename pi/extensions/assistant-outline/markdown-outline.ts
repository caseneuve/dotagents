import type { OutlineNode, ParsedAssistantOutline } from "./types";

function normalizeHeadingTitle(rawTitle: string): string {
  return rawTitle
    .trim()
    .replace(/\s+#+\s*$/, "")
    .replace(/\\([#*_`\\])/g, "$1")
    .trim();
}

function isFenceLine(line: string): boolean {
  return /^\s*(```+|~~~+)/.test(line);
}

export function parseAssistantOutline(
  text: string,
  messageEntryId: string,
): ParsedAssistantOutline {
  const lines = text.split(/\r?\n/);
  const root: OutlineNode = {
    id: "root",
    title: "Whole response",
    level: 0,
    startLine: 0,
    endLine: lines.length,
    children: [],
  };

  const nodesById = new Map<string, OutlineNode>([[root.id, root]]);
  const openStack: OutlineNode[] = [root];
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (isFenceLine(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (!match) continue;

    const level = match[1]?.length ?? 1;
    const title = normalizeHeadingTitle(match[2] ?? "");
    if (!title) continue;

    while (openStack.length > 1) {
      const current = openStack[openStack.length - 1]!;
      if (current.level < level) break;
      current.endLine = index;
      openStack.pop();
    }

    const parent = openStack[openStack.length - 1] ?? root;
    const siblingIndex = parent.children.length + 1;
    const id =
      parent.id === "root" ? `${siblingIndex}` : `${parent.id}.${siblingIndex}`;
    const node: OutlineNode = {
      id,
      title,
      level,
      startLine: index,
      endLine: lines.length,
      children: [],
    };

    parent.children.push(node);
    nodesById.set(node.id, node);
    openStack.push(node);
  }

  while (openStack.length > 1) {
    const current = openStack.pop()!;
    current.endLine = lines.length;
  }

  return {
    messageEntryId,
    text,
    lines,
    root,
    nodesById,
  };
}

export function getNodeMarkdown(
  document: ParsedAssistantOutline,
  node: OutlineNode,
): string {
  return document.lines.slice(node.startLine, node.endLine).join("\n").trim();
}

export function getNodePath(
  document: ParsedAssistantOutline,
  nodeId: string,
): string[] {
  const parts = nodeId === "root" ? [] : nodeId.split(".").map(Number);
  const titles = [document.root.title];
  let current = document.root;

  for (const part of parts) {
    const next = current.children[part - 1];
    if (!next) break;
    titles.push(next.title);
    current = next;
  }

  return titles;
}

export function flattenVisibleOutline(
  root: OutlineNode,
  expanded: ReadonlySet<string>,
): Array<{ node: OutlineNode; depth: number }> {
  const rows: Array<{ node: OutlineNode; depth: number }> = [];

  const visit = (node: OutlineNode, depth: number) => {
    rows.push({ node, depth });
    if (node.children.length === 0) return;
    if (node.id !== "root" && !expanded.has(node.id)) return;
    for (const child of node.children) {
      visit(child, depth + 1);
    }
  };

  visit(root, 0);
  return rows;
}
