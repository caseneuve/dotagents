import { describe, expect, it } from "bun:test";

import {
  buildSubmoduleDiffs,
  parseNullDelimitedPaths,
  prefixDiffPaths,
} from "../../pi/extensions/diff-review";

describe("diff-review submodule helpers", () => {
  it("prefixes nested diff paths while preserving hunks", () => {
    const diff = [
      "diff --git a/src/file.ts b/src/file.ts",
      "index 111..222 100644",
      "--- a/src/file.ts",
      "+++ b/src/file.ts",
      "@@ -10,1 +10,1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");

    expect(prefixDiffPaths(diff, "deps/nested module")).toContain(
      "diff --git a/deps/nested module/src/file.ts b/deps/nested module/src/file.ts",
    );
    expect(prefixDiffPaths(diff, "deps/nested module")).toContain(
      "+++ b/deps/nested module/src/file.ts",
    );
    expect(prefixDiffPaths(diff, "deps/nested module")).toContain(
      "@@ -10,1 +10,1 @@",
    );
  });

  it("parses null-delimited submodule paths with spaces", () => {
    expect(
      parseNullDelimitedPaths("deps/one\0deps/with space\0nested/two\0"),
    ).toEqual(["deps/one", "deps/with space", "nested/two"]);
  });

  it("collects initialized dirty submodule diffs and skips absent foreach entries", () => {
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const runner = (args: string[], cwd?: string) => {
      calls.push({ args, cwd });
      if (args[0] === "submodule") {
        return { ok: true as const, stdout: "deps/dirty module\0" };
      }
      return {
        ok: true as const,
        stdout:
          "diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new\n",
      };
    };

    const result = buildSubmoduleDiffs({ ok: true, mode: "dirty" }, runner);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stdout).toContain(
        "diff --git a/deps/dirty module/file.txt b/deps/dirty module/file.txt",
      );
    }
    expect(calls.map((call) => call.cwd).filter(Boolean)).toEqual([
      `${process.cwd()}/deps/dirty module`,
    ]);
  });

  it("includes dirty-all untracked submodule diffs", () => {
    const runner = (args: string[], _cwd?: string) => {
      if (args[0] === "submodule")
        return { ok: true as const, stdout: "deps/sub\0" };
      return { ok: true as const, stdout: "" };
    };
    const untrackedBuilder = () => ({
      ok: true as const,
      stdout:
        "diff --git a/new.txt b/new.txt\n--- a/new.txt\n+++ b/new.txt\n@@ -0,0 +1 @@\n+new\n",
    });

    const result = buildSubmoduleDiffs(
      { ok: true, mode: "dirty-all" },
      runner,
      untrackedBuilder,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stdout).toContain("+++ b/deps/sub/new.txt");
    }
  });
});
