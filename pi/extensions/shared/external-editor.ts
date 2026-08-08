import { spawnSync } from "node:child_process";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

export type ExternalEditorResult =
  { ok: true } | { ok: false; message: string };

/**
 * Run an external editor with the Pi TUI stopped so the child owns the
 * terminal's input mode and screen. This is required for full-screen editors
 * such as emacsclient, vim, and less.
 */
export async function openExternalEditor(
  ui: Pick<ExtensionUIContext, "custom">,
  editorCommand: string,
  filePath: string,
): Promise<ExternalEditorResult> {
  const [editor, ...editorArgs] = editorCommand.split(" ");
  if (!editor) return { ok: false, message: "Invalid editor command" };

  return ui.custom<ExternalEditorResult>((tui, _theme, _keybindings, done) => {
    let result: ExternalEditorResult;

    tui.stop();
    try {
      const child = spawnSync(editor, [...editorArgs, filePath], {
        stdio: "inherit",
        shell: process.platform === "win32",
      });
      if (child.error) {
        result = { ok: false, message: child.error.message };
      } else if (child.status !== 0) {
        result = {
          ok: false,
          message: `Editor exited with code ${child.status ?? "unknown"}`,
        };
      } else {
        result = { ok: true };
      }
    } catch (error) {
      result = {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      tui.start();
      tui.requestRender(true);
    }

    done(result);
    return { render: () => [], invalidate: () => {} };
  });
}
