import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkTsFiles(full));
      continue;
    }
    if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("editor component ownership", () => {
  it("keeps setEditorComponent ownership in editor-status extension only", () => {
    const files = walkTsFiles("pi/extensions");
    const owners = files.filter((file) =>
      readFileSync(file, "utf8").includes("setEditorComponent("),
    );

    expect(owners).toEqual(["pi/extensions/editor-status.ts"]);
  });
});
