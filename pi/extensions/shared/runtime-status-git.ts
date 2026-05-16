import { execFileSync } from "node:child_process";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const GIT_STATS_TTL_MS = 2000;

export type GitStats = {
  addedLines: number;
  removedLines: number;
  changedFiles: number;
  addedFiles: number;
  untrackedFiles: number;
};

export type GitStatsCache = {
  cwd: string;
  checkedAt: number;
  stats: GitStats | null;
};

function runGit(args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 500,
    });
  } catch {
    return null;
  }
}

function emptyGitStats(): GitStats {
  return {
    addedLines: 0,
    removedLines: 0,
    changedFiles: 0,
    addedFiles: 0,
    untrackedFiles: 0,
  };
}

function readGitStats(): GitStats | null {
  const status = runGit(["status", "--porcelain=v1"]);
  if (status === null) {
    return null;
  }

  const stats = emptyGitStats();
  for (const line of status.split("\n")) {
    if (!line) continue;

    const x = line[0];
    const y = line[1];
    if (x === "?" && y === "?") {
      stats.untrackedFiles += 1;
      continue;
    }

    stats.changedFiles += 1;
    if (x === "A" || y === "A") {
      stats.addedFiles += 1;
    }
  }

  const numstat = runGit(["diff", "--numstat", "HEAD", "--"]);
  if (numstat !== null) {
    for (const line of numstat.split("\n")) {
      if (!line) continue;
      const [added, removed] = line.split("\t");
      if (added !== "-") {
        stats.addedLines += Number.parseInt(added, 10) || 0;
      }
      if (removed !== "-") {
        stats.removedLines += Number.parseInt(removed, 10) || 0;
      }
    }
  }

  if (
    stats.addedLines === 0 &&
    stats.removedLines === 0 &&
    stats.changedFiles === 0 &&
    stats.addedFiles === 0 &&
    stats.untrackedFiles === 0
  ) {
    return null;
  }

  return stats;
}

export function getGitStats(cache: GitStatsCache | undefined): GitStatsCache {
  const now = Date.now();
  const cwd = process.cwd();
  if (cache && cache.cwd === cwd && now - cache.checkedAt < GIT_STATS_TTL_MS) {
    return cache;
  }

  return {
    cwd,
    checkedAt: now,
    stats: readGitStats(),
  };
}

export function formatGitStatsPlain(stats: GitStats | null): string | null {
  if (!stats) return null;

  const fileParts = [String(stats.changedFiles)];
  if (stats.addedFiles > 0) fileParts.push(`A${stats.addedFiles}`);
  if (stats.untrackedFiles > 0) fileParts.push(`?${stats.untrackedFiles}`);

  return `[+${stats.addedLines}/-${stats.removedLines} (${fileParts.join(", ")})]`;
}

export function formatGitStatsStyled(
  theme: ExtensionContext["ui"]["theme"],
  stats: GitStats | null,
): string | null {
  if (!stats) return null;

  const fileParts = [theme.fg("dim", String(stats.changedFiles))];
  if (stats.addedFiles > 0)
    fileParts.push(theme.fg("success", `A${stats.addedFiles}`));
  if (stats.untrackedFiles > 0)
    fileParts.push(theme.fg("warning", `?${stats.untrackedFiles}`));

  return `${theme.fg("dim", "[")}${theme.fg("success", `+${stats.addedLines}`)}${theme.fg(
    "dim",
    "/",
  )}${theme.fg("error", `-${stats.removedLines}`)} ${theme.fg("dim", "(")}${fileParts.join(
    theme.fg("dim", ", "),
  )}${theme.fg("dim", ")]")}`;
}
