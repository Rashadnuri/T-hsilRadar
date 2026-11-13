import { NextResponse } from "next/server";
import { isSameOrigin, readJsonBody } from "@/lib/ai/request-guard";
import { createAiDeps } from "@/lib/ai/server";
import { handleAiRequest } from "@/lib/ai/service";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const json = (body: unknown, status: number, extra: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { ...headers, ...extra } });

/**
 * AI explanations for one opportunity. Server side only: the provider key never leaves the server,
 * and the browser sends just an opportunity id, a task name, its language and (for questions) a short question.
 * Checks, in order: same-origin → signed-in user → body shape → availability/rate limit/validation (service).
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return json({ ok: false, error: "forbidden" }, 403);

  const { auth } = await getAuthContext();
  const user = await auth.getUser();
  if (!user) return json({ ok: false, error: "unauthorized" }, 401);

  const body = await readJsonBody(request);
  if (!body.ok) return json({ ok: false, error: "invalid_request" }, body.status);

  const response = await handleAiRequest(await createAiDeps(user.id), user.id, body.value);
  const retry: Record<string, string> = {};
  if (!response.body.ok && response.body.retryAfterSeconds) retry["Retry-After"] = String(response.body.retryAfterSeconds);
  return json(response.body, response.status, retry);
}
