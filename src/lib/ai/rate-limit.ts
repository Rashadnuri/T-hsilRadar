/**
 * Sliding-window rate limiting for the AI endpoint. In-memory: each server instance counts on
 * its own, which is a deliberate first step (SECURITY.md notes the shared store to use when the
 * site runs on several instances). The `RateLimitStore` boundary keeps that swap small.
 */
export type LimitReason = "minute" | "day" | "global";

export type RateLimitDecision = { allowed: true } | { allowed: false; reason: LimitReason; retryAfterSeconds: number };

export interface RateLimitOptions {
  perMinute: number;
  perDay: number;
  globalPerDay: number;
}

const MINUTE = 60_000;
const DAY = 86_400_000;

export class AiRateLimiter {
  private readonly users = new Map<string, number[]>();
  private globalHits: number[] = [];

  constructor(private readonly options: RateLimitOptions) {}

  /** Counts the request when allowed. Denied requests are not counted, so a blocked client cannot extend its own block. */
  consume(userId: string, now = Date.now()): RateLimitDecision {
    const hits = (this.users.get(userId) ?? []).filter((t) => now - t < DAY);
    this.globalHits = this.globalHits.filter((t) => now - t < DAY);

    const lastMinute = hits.filter((t) => now - t < MINUTE);
    if (lastMinute.length >= this.options.perMinute) {
      return { allowed: false, reason: "minute", retryAfterSeconds: Math.max(1, Math.ceil((lastMinute[0]! + MINUTE - now) / 1000)) };
    }
    if (hits.length >= this.options.perDay) {
      return { allowed: false, reason: "day", retryAfterSeconds: Math.max(1, Math.ceil((hits[0]! + DAY - now) / 1000)) };
    }
    if (this.globalHits.length >= this.options.globalPerDay) {
      return { allowed: false, reason: "global", retryAfterSeconds: Math.max(1, Math.ceil((this.globalHits[0]! + DAY - now) / 1000)) };
    }
    hits.push(now);
    this.users.set(userId, hits);
    this.globalHits.push(now);
    // Keep the map from growing without bound: forget users whose window is empty.
    if (this.users.size > 5000) for (const [id, list] of this.users) if (list.every((t) => now - t >= DAY)) this.users.delete(id);
    return { allowed: true };
  }
}

/** One limiter per server process, created lazily from the configured limits. */
const HOLDER = Symbol.for("tahsilradar.ai-rate-limiter");
export function getAiRateLimiter(options: RateLimitOptions): AiRateLimiter {
  const holder = globalThis as unknown as Record<symbol, { limiter: AiRateLimiter; key: string } | undefined>;
  const key = JSON.stringify(options);
  const existing = holder[HOLDER];
  if (existing && existing.key === key) return existing.limiter;
  const limiter = new AiRateLimiter(options);
  holder[HOLDER] = { limiter, key };
  return limiter;
}
