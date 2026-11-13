import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Locale } from "@/i18n/routing";
import type { AiConfig } from "./config";
import type { MatchSummary, OpportunityFacts } from "./facts";
import type { AiTask } from "./prompt";

/**
 * The one place that talks to a language-model provider. It is READ-ONLY by construction:
 * the request carries no `tools`, so the model has no way to act on anything — it can only
 * return text, which the service then checks and sanitizes. It never touches repositories.
 */
export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  /** Structured copy of what is in the prompt; used only by the development stand-in. */
  meta: { task: AiTask; locale: Locale; facts: OpportunityFacts; match: MatchSummary; question?: string };
}

export type LlmFailure = "refused" | "timeout" | "rate_limited" | "unavailable" | "failed";
export type LlmResult = { ok: true; text: string; truncated: boolean } | { ok: false; reason: LlmFailure };

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResult>;
}

/** Claude through the official SDK. The API key is read on the server only and never leaves this module. */
export class AnthropicLlm implements LlmClient {
  private readonly client: Anthropic;

  constructor(private readonly config: Pick<AiConfig, "apiKey" | "model" | "timeoutMs">, client?: Anthropic) {
    if (!config.apiKey && !client) throw new Error("AnthropicLlm needs an API key");
    this.client = client ?? new Anthropic({ apiKey: config.apiKey!, timeout: config.timeoutMs, maxRetries: 1 });
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    try {
      const response = await this.client.beta.messages.create({
        model: this.config.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: "user", content: request.user }],
        // Explanations are short: low effort keeps cost and latency down. No `tools`: the model cannot act.
        output_config: { effort: "low" },
        // If a safety classifier declines, the API retries on a fallback model by itself.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (response.stop_reason === "refusal") return { ok: false, reason: "refused" };
      const text = response.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("\n")
        .trim();
      if (!text) return { ok: false, reason: "failed" };
      return { ok: true, text, truncated: response.stop_reason === "max_tokens" };
    } catch (error) {
      return { ok: false, reason: classifyError(error) };
    }
  }
}

/** Provider errors → coarse reasons. Messages are dropped: they can echo request content. */
export function classifyError(error: unknown): LlmFailure {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  if (error instanceof Anthropic.RateLimitError) return "rate_limited";
  // A wrong/expired key or a network failure is an availability problem, not the visitor's.
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError || error instanceof Anthropic.APIConnectionError) return "unavailable";
  if (error instanceof Anthropic.APIError && typeof error.status === "number" && error.status >= 500) return "unavailable";
  return "failed";
}
