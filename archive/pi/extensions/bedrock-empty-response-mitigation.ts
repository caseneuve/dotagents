import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Stop only after this many empty Bedrock/Opus responses in a row. A normal
// assistant response resets the counter, so intermittent failures across a long
// task are retried without requiring manual pokes.
const MAX_CONSECUTIVE_EMPTY_RESPONSES = 3;
const AUTO_CONTINUE_TEXT =
  "continue (automatic retry: previous Bedrock/Opus response was empty)";

function isAffectedModel(model: Model<string> | undefined): boolean {
  return (
    model?.provider === "amazon-bedrock" &&
    model.id.toLowerCase().includes("opus")
  );
}

function modelLabel(model: Model<string> | undefined): string {
  return `${model?.provider ?? "unknown"}/${model?.id ?? "unknown"}`;
}

function isAssistantMessage(message: unknown): message is AssistantMessage {
  return (
    !!message &&
    typeof message === "object" &&
    (message as AssistantMessage).role === "assistant"
  );
}

function isEmptySuccessfulAssistant(
  message: unknown,
): message is AssistantMessage {
  if (!isAssistantMessage(message)) return false;
  const usage = message.usage;

  return (
    message.stopReason === "stop" &&
    Array.isArray(message.content) &&
    message.content.length === 0 &&
    !!usage &&
    usage.input === 0 &&
    usage.output === 0 &&
    usage.cacheRead === 0 &&
    usage.cacheWrite === 0 &&
    usage.totalTokens === 0
  );
}

export default function bedrockEmptyResponseMitigation(pi: ExtensionAPI) {
  let active = false;
  let consecutiveEmptyResponses = 0;

  function setActiveForModel(model: Model<string> | undefined) {
    active = isAffectedModel(model);
    consecutiveEmptyResponses = 0;
  }

  pi.on("session_start", async (_event, ctx) => {
    setActiveForModel(ctx.model);
  });

  pi.on("model_select", async (event) => {
    setActiveForModel(event.model);
  });

  pi.on("turn_end", async (event, ctx) => {
    if (!active) return;

    const message = event.message;
    if (!isAssistantMessage(message)) return;

    if (!isEmptySuccessfulAssistant(message)) {
      consecutiveEmptyResponses = 0;
      return;
    }

    consecutiveEmptyResponses += 1;
    const model = modelLabel(ctx.model);

    if (consecutiveEmptyResponses > MAX_CONSECUTIVE_EMPTY_RESPONSES) {
      ctx.ui.notify(
        `Empty assistant response from ${model}; ${MAX_CONSECUTIVE_EMPTY_RESPONSES} auto-continues in a row already tried. Type “continue” manually if appropriate.`,
        "warning",
      );
      return;
    }

    ctx.ui.notify(
      `Empty assistant response from ${model}; auto-continuing (${consecutiveEmptyResponses}/${MAX_CONSECUTIVE_EMPTY_RESPONSES} consecutive).`,
      "warning",
    );

    pi.sendUserMessage(AUTO_CONTINUE_TEXT, { deliverAs: "followUp" });
  });
}
