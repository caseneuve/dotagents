import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  formatGitStatsPlain,
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

function renderTopBorder(
  width: number,
  borderColor: (text: string) => string,
  colorAccent: (text: string) => string,
  colorDim: (text: string) => string,
  leftLabel: string,
  rightLabel: string,
): string {
  if (width <= 0) return "";

  const full = "─".repeat(width);
  let plainLeft = leftLabel;
  const right = rightLabel.trim();

  const rightBudget = right ? visibleWidth(right) + MIN_GAP : 0;
  const leftMax = Math.max(3, width - rightBudget);
  if (visibleWidth(plainLeft) > leftMax) {
    plainLeft = `${truncateToWidth(plainLeft.trim(), Math.max(1, leftMax - 2))} `;
    plainLeft = ` ${plainLeft.trimEnd()} `;
  }

  const leftWidth = visibleWidth(plainLeft);
  const rightWidth = right ? visibleWidth(right) : 0;

  if (!right || leftWidth + MIN_GAP + rightWidth > width) {
    const leftRendered = borderColor("─") + colorAccent(plainLeft);
    return truncateToWidth(`${leftRendered}${borderColor(full)}`, width);
  }

  const gap = Math.max(MIN_GAP, width - leftWidth - rightWidth);
  const leftRendered = borderColor("─") + colorAccent(plainLeft);
  const mid = borderColor("─".repeat(Math.max(0, gap - 1)));
  const rightRendered = colorDim(right);
  return truncateToWidth(`${leftRendered}${mid}${rightRendered}`, width);
}

function installEditor(ctx: ExtensionContext, pi: ExtensionAPI): void {
  let state = readInitialState(ctx);
  let gitStatsCache: GitStatsCache | undefined;

  const fullTheme = ctx.ui.theme;

  ctx.ui.setEditorComponent((tui, _theme, keybindings) => {
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
          (text) => fullTheme.fg("dim", text),
          buildLeftLabel(state),
          rightLabel,
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
