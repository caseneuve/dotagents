import { describe, expect, it } from "bun:test";

import {
  openExternalEditor,
  parseEditorCommand,
} from "../../pi/extensions/shared/external-editor";

describe("parseEditorCommand", () => {
  it("preserves quoted empty arguments", () => {
    expect(
      parseEditorCommand('env TERM=xterm-ghostty-direct emacsclient -nw -a ""'),
    ).toEqual([
      "env",
      "TERM=xterm-ghostty-direct",
      "emacsclient",
      "-nw",
      "-a",
      "",
    ]);
  });

  it("rejects unterminated quotes", () => {
    expect(parseEditorCommand("emacsclient -a '")).toBeUndefined();
  });
});

describe("openExternalEditor", () => {
  it("stops and restarts the TUI around the child process", async () => {
    const events: string[] = [];
    let resolved: { ok: true } | { ok: false; message: string } | undefined;

    const ui = {
      custom: async (factory: any) => {
        const component = factory(
          {
            stop: () => events.push("stop"),
            start: () => events.push("start"),
            requestRender: () => events.push("render"),
          },
          {},
          {},
          (result: typeof resolved) => {
            resolved = result;
          },
        );
        expect(component.render(80)).toEqual([]);
        return resolved;
      },
    };

    const result = await openExternalEditor(ui, "true", "/tmp/editor-test");

    expect(result).toEqual({ ok: true });
    expect(events).toEqual(["stop", "start", "render"]);
  });

  it("restarts and redraws the TUI after a non-zero editor exit", async () => {
    const events: string[] = [];
    const ui = {
      custom: async (factory: any) => {
        let result;
        factory(
          {
            stop: () => events.push("stop"),
            start: () => events.push("start"),
            requestRender: () => events.push("render"),
          },
          {},
          {},
          (value: unknown) => {
            result = value;
          },
        );
        return result;
      },
    };

    await expect(
      openExternalEditor(ui, "false", "/tmp/editor-test"),
    ).resolves.toEqual({
      ok: false,
      message: "Editor exited with code 1",
    });
    expect(events).toEqual(["stop", "start", "render"]);
  });

  it("restarts and reports a missing editor executable", async () => {
    const events: string[] = [];
    const ui = {
      custom: async (factory: any) => {
        let result;
        factory(
          {
            stop: () => events.push("stop"),
            start: () => events.push("start"),
            requestRender: () => events.push("render"),
          },
          {},
          {},
          (value: unknown) => {
            result = value;
          },
        );
        return result;
      },
    };

    const result = await openExternalEditor(
      ui,
      "/definitely/missing/pi-editor",
      "/tmp/editor-test",
    );

    expect(result.ok).toBe(false);
    expect(events).toEqual(["stop", "start", "render"]);
  });

  it("rejects an empty editor command without opening custom UI", async () => {
    let customCalls = 0;
    const ui = {
      custom: async () => {
        customCalls += 1;
        return undefined;
      },
    };

    await expect(
      openExternalEditor(ui, "", "/tmp/editor-test"),
    ).resolves.toEqual({
      ok: false,
      message: "Invalid editor command",
    });
    expect(customCalls).toBe(0);
  });
});
