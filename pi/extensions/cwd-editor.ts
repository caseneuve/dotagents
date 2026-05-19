import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { Key } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type OpenResult = { ok: true; message: string } | { ok: false; message: string };

function openEditorAtPath(targetPath: string): OpenResult {
  const editorCommand = process.env.VISUAL || process.env.EDITOR;
  if (!editorCommand) {
    return {
      ok: false,
      message: "Set $VISUAL or $EDITOR before using /cwd-editor",
    };
  }

  const [editor, ...editorArgs] = editorCommand.split(" ");
  if (!editor) {
    return {
      ok: false,
      message: "Invalid editor command in $VISUAL/$EDITOR",
    };
  }

  const result = spawnSync(editor, [...editorArgs, targetPath], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (typeof result.status === "number" && result.status !== 0) {
    return {
      ok: false,
      message: `Editor exited with code ${result.status}`,
    };
  }

  return {
    ok: true,
    message: `Returned from editor (${targetPath})`,
  };
}

function getPathArgumentCompletions(prefix: string, cwd: string) {
  const rawPrefix = prefix.trim();

  const staticHints = [
    {
      label: ".",
      value: ".",
      description: "open editor in current working directory",
    },
    {
      label: "..",
      value: "..",
      description: "open editor in parent directory",
    },
  ];

  const [baseDirInput, leafPrefix = ""] = rawPrefix.includes("/")
    ? [rawPrefix.slice(0, rawPrefix.lastIndexOf("/") + 1), rawPrefix.slice(rawPrefix.lastIndexOf("/") + 1)]
    : ["", rawPrefix];

  const scanDir = path.resolve(cwd, baseDirInput || ".");
  const fsHints = (() => {
    try {
      return readdirSync(scanDir, { withFileTypes: true })
        .filter((entry) => entry.name.startsWith(leafPrefix))
        .slice(0, 40)
        .map((entry) => {
          const isDir = entry.isDirectory();
          const suffix = isDir ? "/" : "";
          const value = `${baseDirInput}${entry.name}${suffix}`;
          return {
            label: value,
            value,
            description: isDir ? "directory" : "file",
          };
        });
    } catch {
      return [];
    }
  })();

  const staticFiltered = staticHints.filter((hint) =>
    hint.value.startsWith(rawPrefix),
  );

  const combined = [...staticFiltered, ...fsHints];
  return combined.length > 0 ? combined : null;
}

async function openCwdEditor(ctx: ExtensionContext, args = "") {
  if (!ctx.hasUI) {
    ctx.ui.notify("/cwd-editor requires interactive mode", "error");
    return;
  }

  const raw = args.trim();
  const targetPath = raw ? path.resolve(ctx.cwd, raw) : ctx.cwd;
  const opened = openEditorAtPath(targetPath);
  ctx.ui.notify(opened.message, opened.ok ? "success" : "warning");
}

export default function cwdEditorExtension(pi: ExtensionAPI) {
  pi.registerCommand("cwd-editor", {
    description:
      "Open $EDITOR at cwd, or pass a relative file/dir path. Examples: /cwd-editor, /cwd-editor ., /cwd-editor src/",
    getArgumentCompletions: (prefix, ctx) =>
      getPathArgumentCompletions(prefix, ctx?.cwd ?? process.cwd()),
    handler: async (args, ctx) => {
      await openCwdEditor(ctx, args);
    },
  });

  pi.registerShortcut(Key.alt("e"), {
    description: "Open $EDITOR in current working directory",
    handler: async (ctx) => {
      await openCwdEditor(ctx);
    },
  });
}
