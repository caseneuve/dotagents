import { describe, expect, it } from "bun:test";

import { appendEditorText } from "../../pi/extensions/shared/editor-text";

describe("appendEditorText", () => {
  it("returns appended text unchanged when the editor is blank", () => {
    expect(appendEditorText("", "# read this\n")).toBe("# read this\n");
    expect(appendEditorText("  \n", "# read this\n")).toBe("# read this\n");
  });

  it("separates existing draft text and appended text with one blank line", () => {
    expect(appendEditorText("existing prompt", "# read this\n")).toBe(
      "existing prompt\n\n# read this\n",
    );
  });

  it("preserves an existing trailing newline while adding a blank separator line", () => {
    expect(appendEditorText("existing prompt\n", "# read this\n")).toBe(
      "existing prompt\n\n# read this\n",
    );
  });
});
