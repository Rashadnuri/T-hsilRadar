import "server-only";
type Env = Record<string, string | undefined>;

export type AiProvider = "anthropic" | "fake" | "none";

export interface AiLimits {
  /** Requests per user per minute. */
  perMinute: number;
  /** Requests per user per day. */
  perDay: number;
  /** All users together per day: a hard cost ceiling for this server instance. */
  globalPerDay: number;
}

export interface AiConfig {
  provider: AiProvider;
  available: boolean;
  model: string;
  /** SERVER ONLY. Never put this value in a response, a log line or a client component. */
  apiKey: string | null;
  maxOutputTokens: number;
  timeoutMs: number;
  limits: AiLimits;
}

/** What the browser may learn: whether AI features exist. Never the key, model or limits. */
export interface AiAvailability {
  available: boolean;
}

export const DEFAULT_AI_MODEL = "claude-opus-5-5";

const isPlaceholder = (value: string) => /^your-|^changeme$|^<.*>$|example/i.test(value);

const positiveInt = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 100_000 ? n : fallback;
};

/**
 * The AI feature is OPTIONAL. It is available only when:
 *  - `AI_ENABLED` is not "false" (the kill switch), and
 *  - a real `ANTHROPIC_API_KEY` is set (placeholders from .env.example do not count), or
 *  - `AI_FAKE=1` outside production (a deterministic stand-in for development and browser tests).
 * When it is not available the whole platform — including rule-based matching — keeps working.
 */
export function getAiConfig(env: Env = process.env): AiConfig {
  const base = {
    model: env.AI_MODEL?.trim() || DEFAULT_AI_MODEL,
    maxOutputTokens: positiveInt(env.AI_MAX_OUTPUT_TOKENS, 1500),
    timeoutMs: positiveInt(env.AI_TIMEOUT_MS, 30_000),
    limits: {
      perMinute: positiveInt(env.AI_RATE_PER_MINUTE, 5),
      perDay: positiveInt(env.AI_RATE_PER_DAY, 40),
      globalPerDay: positiveInt(env.AI_GLOBAL_PER_DAY, 2000),
    },
  };
  const off: AiConfig = { ...base, provider: "none", available: false, apiKey: null };
  if (env.AI_ENABLED?.trim().toLowerCase() === "false") return off;

  const key = env.ANTHROPIC_API_KEY?.trim();
  if (key && !isPlaceholder(key)) return { ...base, provider: "anthropic", available: true, apiKey: key };
  if (env.AI_FAKE === "1" && env.NODE_ENV !== "production") return { ...base, provider: "fake", available: true, apiKey: null };
  return off;
}

export const getAiAvailability = (env: Env = process.env): AiAvailability => ({ available: getAiConfig(env).available });
