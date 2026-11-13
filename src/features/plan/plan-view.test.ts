import { describe, expect, it } from "vitest";
import { getDemoRecords } from "@/features/opportunities/demo-data";
import { getApplicationState } from "@/lib/opportunities/deadline";
import type { Application, SavedOpportunity } from "@/types/plan";
import { buildPlanView, comparePlanItems, filterByStatus } from "./plan-view";

const records = getDemoRecords();
const NOW = new Date(); // the demo deadlines are relative to the real clock
const byState = (state: string) => records.filter((r) => getApplicationState(r, NOW) === state);
const expired = byState("expired");
const open = byState("open").concat(byState("closing_soon")).filter((r) => r.applicationDeadline);
const rolling = byState("rolling");

const saved = (opportunityId: string, at = "2026-06-01T00:00:00Z"): SavedOpportunity => ({ id: `s-${opportunityId}`, opportunityId, createdAt: at });
const app = (opportunityId: string, status: Application["status"] = "interested", updatedAt = "2026-06-01T00:00:00Z"): Application => ({
  id: `a-${opportunityId}`, opportunityId, status, notes: null, statusChangedAt: updatedAt, createdAt: updatedAt, updatedAt,
});

describe("demo data has what these tests rely on", () => {
  it("includes expired, open-with-deadline and rolling records", () => {
    expect(expired.length).toBeGreaterThan(0);
    expect(open.length).toBeGreaterThan(1);
    expect(rolling.length).toBeGreaterThan(0);
  });
});

describe("buildPlanView", () => {
  it("joins records and keeps expired ones, flagged as expired", () => {
    const view = buildPlanView([saved(expired[0]!.id)], [app(expired[0]!.id)], records, NOW);
    expect(view.saved[0]!.state).toBe("expired");
    expect(view.applications[0]!.state).toBe("expired");
    expect(view.stats.expired).toBe(1); // the same opportunity counts once
  });
  it("shows rows whose opportunity is no longer public (record null) instead of dropping them", () => {
    const view = buildPlanView([saved("gone")], [app("gone")], records, NOW);
    expect(view.saved[0]).toMatchObject({ opportunityId: "gone", record: null, state: null, daysLeft: null });
    expect(view.applications).toHaveLength(1);
  });
  it("orders by soonest deadline, then rolling, then expired, then unavailable", () => {
    const sorted = [...open].sort((a, b) => a.applicationDeadline!.localeCompare(b.applicationDeadline!));
    const ids = [expired[0]!.id, rolling[0]!.id, sorted[1]!.id, "gone", sorted[0]!.id];
    const view = buildPlanView(ids.map((id) => saved(id)), [], records, NOW);
    expect(view.saved.map((i) => i.opportunityId)).toEqual([sorted[0]!.id, sorted[1]!.id, rolling[0]!.id, expired[0]!.id, "gone"]);
  });
  it("puts finished applications (accepted/rejected/withdrawn) after active ones", () => {
    const [first, second] = [...open].sort((a, b) => a.applicationDeadline!.localeCompare(b.applicationDeadline!));
    const view = buildPlanView([], [app(first!.id, "rejected"), app(second!.id, "preparing")], records, NOW);
    expect(view.applications.map((i) => i.application!.status)).toEqual(["preparing", "rejected"]);
  });
  it("lists the most recently ended expired item first", () => {
    const two = [...expired].filter((r) => r.applicationDeadline).sort((a, b) => b.applicationDeadline!.localeCompare(a.applicationDeadline!));
    if (two.length < 2) return;
    const view = buildPlanView([saved(two[1]!.id), saved(two[0]!.id)], [], records, NOW);
    expect(view.saved.map((i) => i.opportunityId)).toEqual([two[0]!.id, two[1]!.id]);
  });
  it("counts 'closing soon' only for things still actionable", () => {
    const soon = records.find((r) => getApplicationState(r, NOW) === "closing_soon");
    if (!soon) return;
    expect(buildPlanView([saved(soon.id)], [], records, NOW).stats.closingSoon).toBe(1);
    expect(buildPlanView([saved(soon.id)], [app(soon.id, "rejected")], records, NOW).stats.closingSoon).toBe(0);
  });
  it("computes days left from the injected clock", () => {
    const target = open[0]!;
    const view = buildPlanView([saved(target.id)], [], records, NOW);
    const expected = Math.ceil((new Date(target.applicationDeadline!).getTime() - NOW.getTime()) / 86_400_000);
    expect(view.saved[0]!.daysLeft).toBe(expected);
  });
  it("is stable when two items tie", () => {
    const a = buildPlanView([saved(rolling[0]!.id, "2026-06-01T00:00:00Z")], [], records, NOW).saved[0]!;
    expect(comparePlanItems(a, a)).toBe(0);
  });
});

describe("filterByStatus", () => {
  it("filters applications by status and passes everything through for null", () => {
    const view = buildPlanView([], [app(open[0]!.id, "applied"), app(open[1]!.id, "interview")], records, NOW);
    expect(filterByStatus(view.applications, "applied")).toHaveLength(1);
    expect(filterByStatus(view.applications, "accepted")).toHaveLength(0);
    expect(filterByStatus(view.applications, null)).toHaveLength(2);
  });
});
