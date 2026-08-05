import { describe, expect, it } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import registerPlaywrightExtension from "../../pi/extensions/playwright";
import { PlaywrightSession } from "../../pi/extensions/playwright/session";

type ToolSchema = {
  required?: string[];
  properties: Record<
    string,
    {
      type?: string;
      minimum?: number;
      maximum?: number;
    }
  >;
};

describe("playwright_set_viewport", () => {
  it("registers bounded integer width and height parameters", () => {
    const tools: Array<{ name: string; parameters: unknown }> = [];
    const pi = {
      registerCommand() {},
      on() {},
      registerTool(tool: { name: string; parameters: unknown }) {
        tools.push(tool);
      },
    } as unknown as ExtensionAPI;

    registerPlaywrightExtension(pi);

    const tool = tools.find(({ name }) => name === "playwright_set_viewport");
    expect(tool).toBeDefined();

    const schema = tool?.parameters as ToolSchema;
    expect(schema.required).toEqual(["width", "height"]);
    expect(schema.properties.width).toMatchObject({
      type: "integer",
      minimum: 1,
      maximum: 8192,
    });
    expect(schema.properties.height).toMatchObject({
      type: "integer",
      minimum: 1,
      maximum: 8192,
    });
  });

  it("requires a page opened through playwright_open", async () => {
    const session = new PlaywrightSession(() => ({ allow: [], deny: [] }));

    expect(session.setViewport({ width: 390, height: 844 })).rejects.toThrow(
      "No active page. Call playwright_open first.",
    );
  });

  it("resizes the active page and reports the applied dimensions", async () => {
    const calls: Array<{ width: number; height: number }> = [];
    const session = new PlaywrightSession(() => ({ allow: [], deny: [] }));

    Object.assign(session, {
      isOpened: true,
      page: {
        isClosed: () => false,
        setViewportSize: async (viewport: {
          width: number;
          height: number;
        }) => {
          calls.push(viewport);
        },
      },
    });

    await expect(
      session.setViewport({ width: 390, height: 844 }),
    ).resolves.toEqual({ width: 390, height: 844 });
    expect(calls).toEqual([{ width: 390, height: 844 }]);
  });
});
