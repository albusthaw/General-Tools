// Starts a Gemini interaction (in background mode where possible) and checks on it
// until it finishes or this run of the worker is nearly out of time. The job's
// saved state carries the interaction between runs.
import { ProviderError } from "../_shared/errors.ts";
import {
  getInteraction,
  type Interaction,
  interactionError,
  interactionId,
  interactionState,
  startInteraction,
} from "../_shared/providers/gemini.ts";
import { sleep } from "../_shared/providers/request.ts";
import type { JobContext } from "./types.ts";

const POLL_MS = 3000;
const SAFETY_MS = 12_000;
// Give up on one interaction after two hours; the job can then start a new one.
const MAX_INTERACTION_MS = 2 * 60 * 60 * 1000;

export type FlowResult =
  | { done: true; interaction: Interaction }
  | { done: false; state: Record<string, unknown> };

function failure(interaction: Interaction): ProviderError {
  const detail = interactionError(interaction) || `status ${String(interaction?.status ?? "unknown")}`;
  const lower = detail.toLowerCase();
  if (/model/.test(lower) && /(not found|not supported|unavailable|invalid)/.test(lower)) {
    return new ProviderError("model", "gemini", `Gemini interaction failed: ${detail}`);
  }
  if (/(safety|blocked|unsupported|could not|invalid argument|audio)/.test(lower)) {
    return new ProviderError("bad_request", "gemini", `Gemini interaction failed: ${detail}`);
  }
  return new ProviderError("unavailable", "gemini", `Gemini interaction failed: ${detail}`);
}

export async function runGeminiInteraction(
  ctx: JobContext,
  apiKey: string,
  state: Record<string, unknown>,
  buildBody: () => Record<string, unknown>,
): Promise<FlowResult> {
  let id = typeof state.interaction_id === "string" ? state.interaction_id : "";
  let next = { ...state };

  if (!id) {
    const directTimeout = Math.max(20_000, Math.min(140_000, ctx.remaining() - 5000));
    const { interaction } = await startInteraction(apiKey, buildBody(), directTimeout);
    const status = interactionState(interaction);
    if (status === "done") return { done: true, interaction };
    if (status === "failed") throw failure(interaction);
    id = interactionId(interaction) ?? "";
    if (!id) throw new ProviderError("invalid_output", "gemini", "Gemini did not return an interaction id.");
    next = { ...next, interaction_id: id, interaction_started_at: Date.now() };
    await ctx.saveState(next);
  }

  const startedAt = Number(next.interaction_started_at ?? Date.now());
  let hiccups = 0;
  while (ctx.remaining() > SAFETY_MS) {
    await sleep(POLL_MS);
    let interaction: Interaction;
    try {
      interaction = await getInteraction(apiKey, id);
      hiccups = 0;
    } catch (error) {
      // A failed check does not mean the work failed; try again shortly.
      if (error instanceof ProviderError && error.retryable && ++hiccups < 5) continue;
      throw error;
    }
    const status = interactionState(interaction);
    if (status === "done") return { done: true, interaction };
    if (status === "failed") throw failure(interaction);
  }

  if (Date.now() - startedAt > MAX_INTERACTION_MS) {
    throw new ProviderError("timeout", "gemini", "Gemini has been working on this for too long.");
  }
  return { done: false, state: next };
}
