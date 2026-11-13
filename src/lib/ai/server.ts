import "server-only";
import { getAuthContext } from "@/lib/auth/session";
import { getOpportunitiesByIds } from "@/services/opportunities";
import { getAiConfig } from "./config";
import { AnthropicLlm, type LlmClient } from "./llm";
import { getAiRateLimiter } from "./rate-limit";
import { AnswerCache, type AiDeps } from "./service";

const CACHE = Symbol.for("tahsilradar.ai-cache");

async function createLlm(config: ReturnType<typeof getAiConfig>): Promise<LlmClient | null> {
  if (config.provider === "anthropic") return new AnthropicLlm(config);
  if (config.provider === "fake") {
    // Loaded lazily, and only when AI_FAKE=1 outside production (see config.ts).
    const { FakeLlm } = await import("./fake-llm");
    return new FakeLlm();
  }
  return null;
}

/**
 * Wires the AI service for one signed-in request. The loaders are READ-ONLY functions: the public
 * opportunity services and the visitor's own profile (under their own session, so row level
 * security applies). The AI module is never given a writer, a repository, or the service-role key.
 */
export async function createAiDeps(userId: string): Promise<AiDeps> {
  const config = getAiConfig();
  const { profiles } = await getAuthContext();
  const holder = globalThis as unknown as Record<symbol, AnswerCache | undefined>;
  const cache = (holder[CACHE] ??= new AnswerCache());
  return {
    config,
    llm: await createLlm(config),
    limiter: getAiRateLimiter(config.limits),
    cache,
    loadOpportunity: async (id) => (await getOpportunitiesByIds([id]))[0] ?? null,
    loadProfile: async () => (profiles ? profiles.get(userId) : null),
  };
}
