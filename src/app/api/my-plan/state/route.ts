import { NextResponse } from "next/server";
import { handleSnapshot } from "@/features/plan/handlers";
import { getAuthContext } from "@/lib/auth/session";

// Per-visitor data: never cacheable, never prerendered.
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * Which opportunities the signed-in visitor has saved / is tracking (ids and statuses only, never
 * notes). The public pages are static, so their save buttons ask for this after loading. The
 * session is verified on the server; anyone else gets 401 and no data.
 */
export async function GET() {
  const { auth, plan } = await getAuthContext();
  const result = await handleSnapshot({ auth, plan, isPublicOpportunity: async () => false });
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: result.code === "unauthorized" ? 401 : 500, headers });
  return NextResponse.json(result.snapshot, { headers });
}
