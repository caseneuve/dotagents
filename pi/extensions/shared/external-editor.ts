import { spawnSync } from "node:child_process";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

export type ExternalEditorResult =
  { ok: true } | { ok: false; message: string };

/** Parse the small shell command subset used by $VISUAL/$EDITOR. */
export function parseEditorCommand(command: string): string[] | undefined {
  const args: string[] = [];
  let current = "";
  let tokenStarted = false;
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (const character of command) {
    if (escaped) {
      current += character;
      tokenStarted = true;
      escaped = false;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = undefined;
      } else if (character === "\\" && quote === '"') {
        escaped = true;
      } else {
        current += character;
      }
      tokenStarted = true;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      tokenStarted = true;
    } else if (character === '"' || character === "'") {
      quote = character;
      tokenStarted = true;
    } else if (/\s/.test(character)) {
      if (tokenStarted) {
        args.push(current);
        current = "";
        tokenStarted = false;
      }
    } else {
      current += character;
      tokenStarted = true;
    }
  }

  if (escaped || quote) return undefined;
  if (tokenStarted) args.push(current);
  return args;
}

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
  const parsedCommand = parseEditorCommand(editorCommand);
  const [editor, ...editorArgs] = parsedCommand ?? [];
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
