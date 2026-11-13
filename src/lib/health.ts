export interface HealthReport {
  status: "ok" | "unavailable";
  /** database: "skipped" when Supabase is not configured (demo mode). */
  checks: { database: "ok" | "error" | "skipped" };
  time: string;
}

/**
 * Liveness + dependency probe for uptime monitors (GET /api/health).
 * `probe` is a cheap read of the real data source (or null when none is configured). It is bounded by a
 * timeout, and its failure is reported only as "error": no message, host or stack ever leaves the server.
 */
export async function buildHealth(
  probe: (() => Promise<unknown>) | null,
  options: { now?: Date; timeoutMs?: number; onError?: (error: unknown) => void } = {},
): Promise<{ httpStatus: 200 | 503; body: HealthReport }> {
  const { now = new Date(), timeoutMs = 3000, onError } = options;
  let database: HealthReport["checks"]["database"] = "skipped";
  if (probe) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([probe(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("health probe timed out")), timeoutMs); })]);
      database = "ok";
    } catch (error) {
      database = "error";
      onError?.(error);
    } finally {
      clearTimeout(timer);
    }
  }
  const ok = database !== "error";
  return { httpStatus: ok ? 200 : 503, body: { status: ok ? "ok" : "unavailable", checks: { database }, time: now.toISOString() } };
}
