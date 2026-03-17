import fs from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

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

export default function attachScreenshotExtension(pi: ExtensionAPI) {
  pi.registerCommand("attach-screenshot", {
    description:
      "Open all screenshots in sxiv, mark one with 'm', quit, and attach it",
    handler: async (args, ctx) => {
      if (!ctx.isIdle()) {
        ctx.ui.notify("Agent is busy. Try again when idle.", "warning");
        return;
      }

      const targetDir = args.trim()
        ? path.resolve(ctx.cwd, args.trim())
        : ctx.cwd;
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
        `Opening ${files.length} image(s) in sxiv. Mark one with 'm', then quit with 'q'.`,
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

      let selected = marked[0];
      if (marked.length > 1) {
        const picked = await ctx.ui.select(
          "Multiple screenshots marked. Choose one to attach:",
          marked.map((file) => path.basename(file)),
        );
        if (!picked) return;
        selected =
          marked.find((file) => path.basename(file) === picked) ?? marked[0];
      }

      let data: Buffer;
      try {
        data = await fs.readFile(selected);
      } catch {
        ctx.ui.notify(`Failed to read selected image: ${selected}`, "error");
        return;
      }

      pi.sendUserMessage([
        {
          type: "text",
          text: `Attaching screenshot: ${path.basename(selected)}`,
        },
        {
          type: "image",
          mimeType: getMimeType(selected),
          data: data.toString("base64"),
        },
      ]);
      ctx.ui.notify(`Attached ${path.basename(selected)}`, "info");
    },
  });
}
