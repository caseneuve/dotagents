import type { ParsedAssistantOutline } from "./types";

export type CommandSnippet = {
  id: string;
  nodeId: string;
  path: string;
  language: string | null;
  startLine: number;
  endLine: number;
  commandText: string;
};

const SHELL_LANGUAGES = new Set(["bash", "sh", "shell", "zsh"]);

function normalizeLanguage(raw: string): string {
  return raw.trim().toLowerCase();
}

function looksShellLike(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;

  return lines.every((line) => {
    if (line.startsWith("#")) return true;
    if (line.startsWith("$ ")) return true;
    if (line.startsWith("/")) return true;
    if (line.startsWith("./")) return true;
    if (/^[A-Za-z0-9_.-]+(\s|$)/.test(line)) return true;
    return false;
  });
}

function isShellFence(language: string | null, body: string): boolean {
  if (language && SHELL_LANGUAGES.has(language)) return true;
  if (!language) return looksShellLike(body);
  return false;
}

function splitCommandChunks(body: string): string[] {
  const chunks: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const text = current.join("\n").trim();
    if (text) chunks.push(text);
    current = [];
  };

  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) {
      flush();
      continue;
    }
    current.push(line.replace(/^\$\s/, ""));
  }
  flush();
  return chunks;
}

function findOwningNodeId(
  document: ParsedAssistantOutline,
  lineIndex: number,
): string {
  let bestId = document.root.id;
  let bestLevel = 0;

  for (const [nodeId, node] of document.nodesById.entries()) {
    if (nodeId === "root") continue;
    if (
      node.startLine <= lineIndex &&
      lineIndex < node.endLine &&
      node.level >= bestLevel
    ) {
      bestId = nodeId;
      bestLevel = node.level;
    }
  }

  return bestId;
}

function getNodePath(document: ParsedAssistantOutline, nodeId: string): string {
  if (nodeId === "root") return document.root.title;

  const indices = nodeId.split(".").map((part) => Number(part) - 1);
  const titles = [document.root.title];
  let current = document.root;

  for (const index of indices) {
    const next = current.children[index];
    if (!next) break;
    titles.push(next.title);
    current = next;
  }

  return titles.join(" > ");
}

export function extractCommandSnippets(
  document: ParsedAssistantOutline,
): CommandSnippet[] {
  const snippets: CommandSnippet[] = [];
  const lines = document.lines;

  let index = 0;
  let snippetIndex = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const openMatch = line.match(/^\s*(```+|~~~+)([^`]*)$/);
    if (!openMatch) {
      index += 1;
      continue;
    }

    const fence = openMatch[1] ?? "```";
    const language = normalizeLanguage(openMatch[2] ?? "") || null;
    const bodyLines: string[] = [];
    const startLine = index;
    index += 1;

    while (index < lines.length) {
      const bodyLine = lines[index] ?? "";
      if (new RegExp(`^\\s*${fence}\\s*$`).test(bodyLine)) {
        break;
      }
      bodyLines.push(bodyLine);
      index += 1;
    }

    const endLine = Math.min(lines.length, index + 1);
    const body = bodyLines.join("\n").trim();
    if (body && isShellFence(language, body)) {
      const nodeId = findOwningNodeId(document, startLine);
      const path = getNodePath(document, nodeId);
      for (const chunk of splitCommandChunks(body)) {
        snippetIndex += 1;
        snippets.push({
          id: `cmd-${snippetIndex}`,
          nodeId,
          path,
          language,
          startLine,
          endLine,
          commandText: chunk,
        });
      }
    }

    index += 1;
  }

  return snippets;
}
