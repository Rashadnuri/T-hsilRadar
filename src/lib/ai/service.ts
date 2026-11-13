import { createHash } from "node:crypto";
import { z } from "zod";
import { locales, type Locale } from "@/i18n/routing";
import { matchOpportunity, toMatchProfile } from "@/lib/matching/engine";
import type { ProfileInput } from "@/types/profile";
import type { OpportunityRecord } from "@/types/opportunity";
import type { AiConfig } from "./config";
import { buildOpportunityFacts, summarizeMatch, summarizeProfile } from "./facts";
import { findUngroundedNumbers, matchesLanguage, type AiWarning } from "./grounding";
import type { LlmClient } from "./llm";
import { AI_TASKS, buildSystemPrompt, buildUserPrompt, QUESTION_MAX_LENGTH, type AiTask } from "./prompt";
import type { AiRateLimiter } from "./rate-limit";
import { looksLikeInjection, sanitizeOutput, sanitizeUntrusted } from "./sanitize";

/**
 * Orchestrates one AI request, independent of Next.js so it can be tested with fakes. The order
 * is deliberate — cheap, safe checks first, the paid call last:
 *   availability → input validation → rate limit → read the public record (read-only) →
 *   build the grounded prompt → (cache) → model → sanitize + verify → answer.
 * Nothing here can write to a record: the dependencies it receives are read functions.
 */

export type AiErrorCode = "ai_unavailable" | "invalid_request" | "invalid_question" | "not_found" | "rate_limited" | "ai_failed";

export interface AiAnswer {
  task: AiTask;
  locale: Locale;
  /** The visible answer. ALWAYS AI-generated: the UI labels it as such and shows official data separately. */
  text: string;
  generatedAt: string;
  warnings: AiWarning[];
}

export type AiResponse =
  | { status: 200; body: { ok: true; answer: AiAnswer } }
  | { status: 400 | 404 | 429 | 502 | 503; body: { ok: false; error: AiErrorCode; retryAfterSeconds?: number } };

export interface AiDeps {
  config: AiConfig;
  llm: LlmClient | null;
  limiter: AiRateLimiter;
  /** Read-only: the PUBLIC record (same data any visitor can see). */
  loadOpportunity(id: string): Promise<OpportunityRecord | null>;
  /** Read-only: the signed-in user's OWN profile, or null. */
  loadProfile(): Promise<ProfileInput | null>;
  now?: () => Date;
  cache?: AnswerCache;
}

const requestSchema = z.object({
  opportunityId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
  task: z.enum(AI_TASKS),
  locale: z.enum(locales),
  question: z.string().max(QUESTION_MAX_LENGTH * 4).optional(),
});

/** Small in-memory answer cache: identical grounded inputs → identical answer, no second paid call. */
export class AnswerCache {
  private readonly entries = new Map<string, { at: number; answer: AiAnswer }>();
  constructor(private readonly ttlMs = 30 * 60_000, private readonly max = 200) {}
  get(key: string, now: number): AiAnswer | null {
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (now - hit.at > this.ttlMs) {
      this.entries.delete(key);
      return null;
    }
    return hit.answer;
  }
  set(key: string, answer: AiAnswer, now: number) {
    if (this.entries.size >= this.max) this.entries.delete(this.entries.keys().next().value as string);
    this.entries.set(key, { at: now, answer });
  }
}

const fail = (status: 400 | 404 | 429 | 502 | 503, error: AiErrorCode, retryAfterSeconds?: number): AiResponse => ({ status, body: { ok: false, error, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) } });

/** Validates the question: bounded, printable, and not an obvious attempt to steer the assistant. */
export function cleanQuestion(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (trimmed.length < 3 || trimmed.length > QUESTION_MAX_LENGTH) return null;
  if (looksLikeInjection(trimmed)) return null;
  return sanitizeUntrusted(trimmed, QUESTION_MAX_LENGTH);
}

export async function handleAiRequest(deps: AiDeps, userId: string, rawInput: unknown): Promise<AiResponse> {
  const now = (deps.now ?? (() => new Date()))();

  // 1. The feature is optional: without a key or with the kill switch, say so (and the rest of the site is unaffected).
  if (!deps.config.available || !deps.llm) return fail(503, "ai_unavailable");

  // 2. Validate everything the browser sent.
  const parsed = requestSchema.safeParse(rawInput);
  if (!parsed.success) return fail(400, "invalid_request");
  const { opportunityId, task, locale } = parsed.data;
  let question: string | null = null;
  if (task === "ask") {
    question = cleanQuestion(parsed.data.question);
    if (!question) return fail(400, "invalid_question");
  }

  // 3. Rate limit (per user per minute / day, and a global daily ceiling).
  const decision = deps.limiter.consume(userId, now.getTime());
  if (!decision.allowed) return fail(429, "rate_limited", decision.retryAfterSeconds);

  // 4. Read-only data: the public record and the user's own profile.
  const [record, profileInput] = await Promise.all([deps.loadOpportunity(opportunityId), deps.loadProfile()]);
  if (!record) return fail(404, "not_found");

  const profile = toMatchProfile(profileInput);
  const match = matchOpportunity(profile, record, now);
  const facts = buildOpportunityFacts(record, locale, now);
  const matchSummary = summarizeMatch(match);
  const profileSummary = summarizeProfile(profile);

  const system = buildSystemPrompt(locale);
  const user = buildUserPrompt({ task, locale, facts, match: matchSummary, profile: profileSummary, question: question ?? undefined });

  // 5. Cache (not for free-form questions).
  const cacheKey = task === "ask" ? null : createHash("sha256").update(JSON.stringify([task, locale, deps.config.model, system, user])).digest("hex");
  if (cacheKey && deps.cache) {
    const hit = deps.cache.get(cacheKey, now.getTime());
    if (hit) return { status: 200, body: { ok: true, answer: hit } };
  }

  // 6. The model call.
  const result = await deps.llm.complete({ system, user, maxTokens: deps.config.maxOutputTokens, meta: { task, locale, facts, match: matchSummary, question: question ?? undefined } });
  if (!result.ok) {
    if (result.reason === "unavailable" || result.reason === "timeout") return fail(503, "ai_unavailable");
    if (result.reason === "rate_limited") return fail(429, "rate_limited", 30);
    return fail(502, "ai_failed");
  }

  // 7. The answer is untrusted: clean it, then verify it against the data the model was given.
  const cleaned = sanitizeOutput(result.text);
  if (!cleaned.text) return fail(502, "ai_failed");
  const warnings: AiWarning[] = [];
  if (cleaned.removedLinks) warnings.push("links_removed");
  if (result.truncated) warnings.push("truncated");
  // What the model saw (everything it may legitimately repeat): the prompt itself, i.e. facts, match and profile.
  if (findUngroundedNumbers(cleaned.text, `${system}\n${user}`).length > 0) warnings.push("unverified_numbers");
  if (!matchesLanguage(cleaned.text, locale)) warnings.push("language_mismatch");

  const answer: AiAnswer = { task, locale, text: cleaned.text, generatedAt: now.toISOString(), warnings };
  if (cacheKey && deps.cache && warnings.length === 0) deps.cache.set(cacheKey, answer, now.getTime());
  return { status: 200, body: { ok: true, answer } };
}
