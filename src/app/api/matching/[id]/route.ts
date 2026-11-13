import { NextResponse } from "next/server";
import { getAiAvailability } from "@/lib/ai/config";
import { matchOpportunity, toMatchProfile } from "@/lib/matching/engine";
import { getAuthContext } from "@/lib/auth/session";
import { parseOpportunityId } from "@/validation/plan";
import { getOpportunitiesByIds } from "@/services/opportunities";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * The rule-based match of the signed-in visitor's own profile against one public opportunity.
 * Pure computation over read-only data: it needs no AI, no key and no network, so it works even
 * when the AI feature is off. Returns codes and data only (the browser localizes them).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = parseOpportunityId(rawId);
  if (!id) return NextResponse.json({ error: "invalid_request" }, { status: 400, headers });

  const { auth, profiles } = await getAuthContext();
  const user = await auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });

  const [record] = await getOpportunitiesByIds([id]);
  if (!record) return NextResponse.json({ error: "not_found" }, { status: 404, headers });

  const profile = profiles ? await profiles.get(user.id) : null;
  const match = matchOpportunity(toMatchProfile(profile), record);
  return NextResponse.json({ match, hasProfile: profile !== null, ai: getAiAvailability() }, { headers });
}
