import fs from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const DEFAULT_SCREENSHOTS_DIR = "/tmp/screenshots";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

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
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
    )
    .map((entry) => path.join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function formatDirForDisplay(dir: string, cwd: string): string {
  return dir.startsWith(cwd) ? path.relative(cwd, dir) || "." : dir;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("attach-screenshot", {
    description:
      "Open screenshots in sxiv, mark with 'm', quit, and attach all marked (default: /tmp/screenshots, '.' = cwd)",
    handler: async (args, ctx) => {
      if (!ctx.isIdle()) {
        ctx.ui.notify("Agent is busy. Try again when idle.", "warning");
        return;
      }

      const trimmedArgs = args.trim();
      const targetDir = !trimmedArgs
        ? DEFAULT_SCREENSHOTS_DIR
        : trimmedArgs === "."
          ? ctx.cwd
          : path.resolve(ctx.cwd, trimmedArgs);
      let files: string[];
      try {
        files = await listImages(targetDir);
      } catch (error) {
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
        `Opening ${files.length} image(s) in sxiv. Mark one or more with 'm', then quit with 'q'.`,
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

      const marked = result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      if (marked.length === 0) {
        ctx.ui.notify("No screenshot marked in sxiv.", "warning");
        return;
      }

      const attachments: Array<
        | { type: "text"; text: string }
        | { type: "image"; mimeType: string; data: string }
      > = [];
      const failed: string[] = [];

      attachments.push({
        type: "text",
        text:
          marked.length === 1
            ? `Attaching screenshot: ${path.basename(marked[0])}`
            : `Attaching ${marked.length} screenshots: ${marked.map((file) => path.basename(file)).join(", ")}`,
      });

      for (const selected of marked) {
        try {
          const data = await fs.readFile(selected);
          attachments.push({
            type: "image",
            mimeType: getMimeType(selected),
            data: data.toString("base64"),
          });
        } catch {
          failed.push(selected);
        }
      }

      if (attachments.length === 1) {
        ctx.ui.notify("Could not read any marked screenshots.", "error");
        return;
      }

      pi.sendUserMessage(attachments);

      const attachedCount = attachments.length - 1;
      ctx.ui.notify(`Attached ${attachedCount} screenshot(s).`, "info");
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
