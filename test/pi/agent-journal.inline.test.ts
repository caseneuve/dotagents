import { describe, expect, it } from "bun:test";
import { renderInlineOrg } from "../../pi/extensions/agent-journal";

const theme = {
  fg: (_token: string, text: string) => text,
  bold: (text: string) => text,
} as const;

describe("agent-journal inline org rendering", () => {
  it("does not treat slash-separated words as italics", () => {
    const input =
      "Validated in code/history and explain/lint guidance with fixture strings.";

    const output = renderInlineOrg(theme as never, input);

    expect(output).toBe(input);
    expect(output.includes("\u001b[3m")).toBe(false);
  });

  it("renders real org italics delimited by slashes", () => {
    const input = "Updated status to /done/.";

    const output = renderInlineOrg(theme as never, input);

    expect(output).toBe("Updated status to \u001b[3mdone\u001b[23m.");
  });

  it("does not misparse URL slashes as org italics", () => {
    const input = "See http://example.com/path for details.";

    const output = renderInlineOrg(theme as never, input);

    expect(output).toBe(input);
    expect(output.includes("\u001b[3m")).toBe(false);
  });
});
