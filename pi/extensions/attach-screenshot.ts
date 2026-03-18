import fs from "node:fs/promises";
import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";

const DEFAULT_SCREENSHOTS_DIR = "/tmp/screenshots";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const MARKER_PREFIX = "[screenshot#";
const MARKER_REGEX = /\[screenshot#([^:\]]+):([^\]]+)\]/g;

type PendingScreenshot = {
  id: string;
  file: string;
  mimeType: string;
  data: string;
};

function getMimeType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "image/png";
  }
}

async function listImages(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
      )
      .map(async (entry) => {
        const file = path.join(dir, entry.name);
        const stat = await fs.stat(file);
        return { file, mtimeMs: stat.mtimeMs };
      }),
  );

  return files
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.file.localeCompare(a.file))
    .map((entry) => entry.file);
}

function formatDirForDisplay(dir: string, cwd: string): string {
  return dir.startsWith(cwd) ? path.relative(cwd, dir) || "." : dir;
}

function parseCommandArgs(
  rawArgs: string,
  cwd: string,
): { targetDir: string; editorText?: string } {
  const [dirPart, editorTextPart] = rawArgs.split(/\s+--\s+/, 2);
  const trimmedDirPart = dirPart.trim();
  const trimmedEditorText = editorTextPart?.trim();

  const targetDir = !trimmedDirPart
    ? DEFAULT_SCREENSHOTS_DIR
    : trimmedDirPart === "."
      ? cwd
      : path.resolve(cwd, trimmedDirPart);

  return {
    targetDir,
    editorText: trimmedEditorText || undefined,
  };
}

function createMarker(id: string, file: string): string {
  return `${MARKER_PREFIX}${id}:${path.basename(file)}]`;
}

function stripConsumedMarkers(text: string): string {
  return text
    .replace(/ ?\[screenshot#[^\]]+\] ?/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export default function (pi: ExtensionAPI) {
  const pendingScreenshots = new Map<string, PendingScreenshot>();
  let nextMarkerId = 1;

  function refreshPendingUi(ctx: ExtensionContext) {
    const pending = pendingScreenshots.size;
    if (pending === 0) {
      ctx.ui.setStatus("attach-screenshot", undefined);
      return;
    }

    ctx.ui.setStatus(
      "attach-screenshot",
      `${pending} screenshot${pending === 1 ? "" : "s"} queued`,
    );
  }

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension" || pendingScreenshots.size === 0) {
      return { action: "continue" };
    }

    const consumedIds: string[] = [];
    let match = MARKER_REGEX.exec(event.text);
    while (match) {
      consumedIds.push(match[1]);
      match = MARKER_REGEX.exec(event.text);
    }
    MARKER_REGEX.lastIndex = 0;

    if (consumedIds.length === 0) {
      const discardedCount = pendingScreenshots.size;
      pendingScreenshots.clear();
      refreshPendingUi(ctx);
      ctx.ui.notify(
        `Discarded ${discardedCount} queued screenshot${discardedCount === 1 ? "" : "s"} because no screenshot markers remained in the message.`,
        "info",
      );
      return { action: "continue" };
    }

    const attachedImages = [];
    const missingIds: string[] = [];
    const seenIds = new Set<string>();

    for (const id of consumedIds) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const screenshot = pendingScreenshots.get(id);
      if (!screenshot) {
        missingIds.push(id);
        continue;
      }

      attachedImages.push({
        type: "image" as const,
        data: screenshot.data,
        mimeType: screenshot.mimeType,
      });
      pendingScreenshots.delete(id);
    }

    refreshPendingUi(ctx);

    if (missingIds.length > 0) {
      ctx.ui.notify(
        `Some queued screenshot marker(s) no longer matched stored data: ${missingIds.join(", ")}`,
        "warning",
      );
    }

    const existingImages = event.images ?? [];

    if (attachedImages.length === 0) {
      return {
        action: "transform",
        text: stripConsumedMarkers(event.text),
        images: existingImages,
      };
    }

    ctx.ui.notify(
      `Attached ${attachedImages.length} queued screenshot${attachedImages.length === 1 ? "" : "s"} to your message.`,
      "info",
    );

    return {
      action: "transform",
      text: stripConsumedMarkers(event.text),
      images: [...existingImages, ...attachedImages],
    };
  });

  pi.registerCommand("attach-screenshot", {
    description:
      "Open screenshots in sxiv, mark with 'm', and paste screenshot markers into the editor (default: /tmp/screenshots, '.' = cwd, optional text after --)",
    handler: async (args, ctx) => {
      if (!ctx.isIdle()) {
        ctx.ui.notify("Agent is busy. Try again when idle.", "warning");
        return;
      }

      const { targetDir, editorText } = parseCommandArgs(args.trim(), ctx.cwd);

      let files: string[];
      try {
        files = await listImages(targetDir);
      } catch {
        ctx.ui.notify(`Failed to read directory: ${targetDir}`, "error");
        return;
      }

      if (files.length === 0) {
        ctx.ui.notify(
          `No images found in ${formatDirForDisplay(targetDir, ctx.cwd)}`,
          "warning",
        );
        return;
      }

      ctx.ui.notify(
        `Opening ${files.length} image(s) in sxiv, newest first. Mark one or more with 'm', then quit with 'q'.`,
        "info",
      );

      const result = await pi.exec("sxiv", ["-to", ...files]);
      if (result.killed || result.code === null) {
        ctx.ui.notify("sxiv did not finish cleanly.", "warning");
        return;
      }

      if (result.code !== 0) {
        const message =
          result.stderr.trim() || `sxiv exited with code ${result.code}`;
        ctx.ui.notify(message, "error");
        return;
      }

      const selectedPaths = result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      if (selectedPaths.length === 0) {
        ctx.ui.notify("No screenshot marked in sxiv.", "warning");
        return;
      }

      const fileOrder = new Map(files.map((file, index) => [file, index]));
      const marked = [...selectedPaths].sort(
        (a, b) =>
          (fileOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
          (fileOrder.get(b) ?? Number.MAX_SAFE_INTEGER),
      );

      const pastedMarkers: string[] = [];
      const failed: string[] = [];

      for (const selected of marked) {
        try {
          const data = await fs.readFile(selected);
          const id = String(nextMarkerId++);
          pendingScreenshots.set(id, {
            id,
            file: selected,
            mimeType: getMimeType(selected),
            data: data.toString("base64"),
          });
          pastedMarkers.push(createMarker(id, selected));
        } catch {
          failed.push(selected);
        }
      }

      if (pastedMarkers.length === 0) {
        ctx.ui.notify("Could not read any marked screenshots.", "error");
        return;
      }

      const editorInsert = [pastedMarkers.join(" "), editorText]
        .filter(Boolean)
        .join(editorText ? "\n\n" : " ");
      ctx.ui.pasteToEditor(`${editorInsert} `);
      refreshPendingUi(ctx);

      ctx.ui.notify(
        pastedMarkers.length === 1
          ? `Queued 1 screenshot and pasted its marker into the editor.`
          : `Queued ${pastedMarkers.length} screenshots and pasted their markers into the editor.`,
        "info",
      );

      if (failed.length > 0) {
        ctx.ui.notify(
          `Failed to read ${failed.length} marked screenshot(s): ${failed
            .map((file) => path.basename(file))
            .join(", ")}`,
          "warning",
        );
      }
    },
  });
}
