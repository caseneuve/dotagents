import { describe, expect, it } from "bun:test";

import {
  DEFAULT_THINKING_MAPPING,
  thinkingBlockTone,
} from "../../pi/extensions/runtime-footer";

describe("runtime-footer thinking blocks", () => {
  it("maps every supported thinking level to a distinct glyph", () => {
    expect(DEFAULT_THINKING_MAPPING).toEqual({
      off: "▁",
      minimal: "▂",
      low: "▃",
      medium: "▄",
      high: "▅",
      xhigh: "▆",
      max: "█",
    });
    expect(new Set(Object.values(DEFAULT_THINKING_MAPPING)).size).toBe(
      Object.keys(DEFAULT_THINKING_MAPPING).length,
    );
  });

  it("gives max a stronger tone than xhigh", () => {
    expect(thinkingBlockTone("xhigh")).toBe("warning");
    expect(thinkingBlockTone("max")).toBe("error");
  });
});
