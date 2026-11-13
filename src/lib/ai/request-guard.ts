/**
 * Guards for JSON POST endpoints that use cookie sessions. Route handlers (unlike Server Actions)
 * are not Origin-checked by Next.js, so this does it explicitly: a cross-site page must not be able
 * to make a visitor's browser spend their AI quota.
 */
export const MAX_BODY_BYTES = 4096;

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false; // browsers always send Origin on POST; anything else is not our UI
  try {
    return new URL(origin).host === host.split(",")[0]!.trim();
  } catch {
    return false;
  }
}

export type BodyResult = { ok: true; value: unknown } | { ok: false; status: 400 | 413 | 415 };

/** Reads a small JSON body: content type, size limit and syntax are all checked before use. */
export async function readJsonBody(request: Request): Promise<BodyResult> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return { ok: false, status: 415 };
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return { ok: false, status: 413 };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { ok: false, status: 413 };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400 };
  }
}
