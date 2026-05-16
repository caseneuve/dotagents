import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  formatGitStatsPlain,
  formatGitStatsStyled,
  getGitStats,
  type GitStatsCache,
} from "./shared/runtime-status-git";

const MIN_GAP = 1;

type EditorStatusState = {
  name: string;
  commsActive: boolean;
};

function readInitialState(ctx: ExtensionContext): EditorStatusState {
  let name = "agent";
  let commsActive = false;

  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "custom") continue;
    if (entry.customType === "agent-channel-identity") {
      const data = (entry as { data?: { label?: string; id?: string } }).data;
      if (data?.label) name = data.label;
      else if (data?.id) name = data.id;
    }
    if (entry.customType === "agent-channel-comms") {
      const data = (entry as { data?: { active?: unknown } }).data;
      if (typeof data?.active === "boolean") commsActive = data.active;
    }
  }

  return { name, commsActive };
}

function buildLeftLabel(state: EditorStatusState): string {
  return state.commsActive ? ` ${state.name} 📡 ` : ` ${state.name} `;
}

function clipLabel(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  let out = "";
  let used = 0;
  for (const ch of text) {
    const w = visibleWidth(ch);
    if (used + w > maxWidth) break;
    out += ch;
    used += w;
  }
  return out;
}

function renderTopBorder(
  width: number,
  borderColor: (text: string) => string,
  colorAccent: (text: string) => string,
  leftLabel: string,
  rightPlain: string,
  rightStyled: string,
): string {
  if (width <= 0) return "";

  const right = rightPlain.trim();
  let plainLeft = leftLabel;

  const rightBudget = right ? visibleWidth(right) + MIN_GAP : 0;
  const leftMax = Math.max(3, width - 1 - rightBudget);
  if (visibleWidth(plainLeft) > leftMax) {
    const clipped = clipLabel(plainLeft.trim(), Math.max(1, leftMax - 2));
    plainLeft = ` ${clipped} `;
  }

  const leftWidth = visibleWidth(plainLeft);
  const leftSegmentWidth = 1 + leftWidth;
  const rightWidth = right ? visibleWidth(right) : 0;
  const rightSegmentWidth = rightWidth > 0 ? rightWidth + 1 : 0;

  if (!right || width - leftSegmentWidth - rightSegmentWidth < MIN_GAP) {
    const tailWidth = Math.max(0, width - leftSegmentWidth);
    return (
      borderColor("─") +
      colorAccent(plainLeft) +
      borderColor("─".repeat(tailWidth))
    );
  }

  const gapWidth = width - leftSegmentWidth - rightSegmentWidth;
  return (
    borderColor("─") +
    colorAccent(plainLeft) +
    borderColor("─".repeat(gapWidth)) +
    rightStyled +
    borderColor("─")
  );
}

function installEditor(ctx: ExtensionContext, pi: ExtensionAPI): void {
  let state = readInitialState(ctx);
  let gitStatsCache: GitStatsCache | undefined;

  const fullTheme = ctx.ui.theme;

  ctx.ui.setEditorComponent((tui, theme, keybindings) => {
    const disposeName = pi.events.on("agent-channel:name", (value: unknown) => {
      if (typeof value === "string" && value.trim().length > 0) {
        state = { ...state, name: value.trim() };
        tui.requestRender();
      }
    });

    const disposeComms = pi.events.on(
      "agent-channel:comms",
      (value: unknown) => {
        state = { ...state, commsActive: value === true };
        tui.requestRender();
      },
    );

    const editor = new (class extends CustomEditor {
      render(width: number): string[] {
        const lines = super.render(width);
        if (lines.length === 0 || width <= 0) return lines;

        gitStatsCache = getGitStats(gitStatsCache);
        const rightLabel = formatGitStatsPlain(gitStatsCache.stats) ?? "";
        lines[0] = renderTopBorder(
          width,
          this.borderColor.bind(this),
          (text) => fullTheme.fg("accent", text),
          buildLeftLabel(state),
          rightLabel,
          formatGitStatsStyled(fullTheme, gitStatsCache.stats) ?? "",
        );
        return lines;
      }

      dispose(): void {
        super.dispose();
        disposeName();
        disposeComms();
      }
    })(tui, theme, keybindings);

    return editor;
  });
}

export default function editorStatusExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    installEditor(ctx, pi);
  });
}
