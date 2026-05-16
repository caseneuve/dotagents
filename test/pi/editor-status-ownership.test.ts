import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

describe("editor component ownership", () => {
  it("keeps setEditorComponent ownership in editor-status extension only", () => {
    const editorStatus = readFileSync("pi/extensions/editor-status.ts", "utf8");
    const agentChannel = readFileSync("pi/extensions/agent-channel/index.ts", "utf8");
    const runtimeFooter = readFileSync("pi/extensions/runtime-footer.ts", "utf8");

    expect(editorStatus.includes("setEditorComponent(")).toBe(true);
    expect(agentChannel.includes("setEditorComponent(")).toBe(false);
    expect(runtimeFooter.includes("setEditorComponent(")).toBe(false);
  });
});
