import { NextResponse } from "next/server";
import { buildHealth } from "@/lib/health";
import { isSupabaseConfigured } from "@/lib/env";
import { listOpportunities } from "@/services/opportunities";
import type { OpportunityFilters } from "@/validation/opportunity-filters";

export const dynamic = "force-dynamic";

/**
 * For uptime monitors (and Vercel / load-balancer checks): 200 when the app and its database answer,
 * 503 when the database does not. Public and unauthenticated by design, so it reveals nothing beyond
 * "ok / error" — no versions, hosts, counts or error text.
 */
export async function GET() {
  const probe = isSupabaseConfigured() ? () => listOpportunities({ page: 1 } as OpportunityFilters, { pageSize: 1 }) : null;
  const { httpStatus, body } = await buildHealth(probe, { onError: (e) => console.error(JSON.stringify({ level: "error", event: "health_probe_failed", message: e instanceof Error ? e.message.slice(0, 200) : "unknown" })) });
  return NextResponse.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
}
