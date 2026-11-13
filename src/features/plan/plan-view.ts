import { daysUntilDeadline, getApplicationState, type ApplicationState } from "@/lib/opportunities/deadline";
import type { OpportunityRecord } from "@/types/opportunity";
import { FINAL_STATUSES, type Application, type ApplicationStatus, type SavedOpportunity } from "@/types/plan";

/** One row of the plan page: the person's own record joined with the (public) opportunity, if it is still public. */
export interface PlanItem {
  opportunityId: string;
  /** null when the opportunity is no longer public (unpublished/removed): the row is still shown so it can be cleaned up. */
  record: OpportunityRecord | null;
  state: ApplicationState | null;
  daysLeft: number | null;
  saved: SavedOpportunity | null;
  application: Application | null;
}

export interface PlanView {
  applications: PlanItem[];
  saved: PlanItem[];
  stats: { applications: number; saved: number; closingSoon: number; expired: number };
}

/**
 * Sort rank: items with a fixed, still-open deadline first (soonest first); rolling/unknown/upcoming
 * next; expired after that; unavailable last. Finished applications (accepted/rejected/withdrawn)
 * sink below the active ones, because nothing is expected of them any more.
 */
function rank(item: PlanItem): number {
  const finished = item.application && FINAL_STATUSES.includes(item.application.status) ? 10 : 0;
  if (!item.record) return finished + 3;
  if (item.state === "expired") return finished + 2;
  if (item.state === "open" || item.state === "closing_soon") return finished;
  return finished + 1;
}

const deadlineMs = (item: PlanItem) => (item.record?.applicationDeadline ? new Date(item.record.applicationDeadline).getTime() : Infinity);

export function comparePlanItems(a: PlanItem, b: PlanItem): number {
  const byRank = rank(a) - rank(b);
  if (byRank !== 0) return byRank;
  // Expired: the most recently ended first; everything else: soonest deadline first.
  const [da, db] = [deadlineMs(a), deadlineMs(b)];
  if (da !== db) return a.state === "expired" ? db - da : da - db;
  return (b.application?.updatedAt ?? b.saved?.createdAt ?? "").localeCompare(a.application?.updatedAt ?? a.saved?.createdAt ?? "");
}

export function buildPlanView(saved: SavedOpportunity[], applications: Application[], records: OpportunityRecord[], now = new Date()): PlanView {
  const byId = new Map(records.map((r) => [r.id, r] as const));
  const savedById = new Map(saved.map((s) => [s.opportunityId, s] as const));
  const applicationById = new Map(applications.map((a) => [a.opportunityId, a] as const));

  const item = (opportunityId: string): PlanItem => {
    const record = byId.get(opportunityId) ?? null;
    return {
      opportunityId,
      record,
      state: record ? getApplicationState(record, now) : null,
      daysLeft: record ? daysUntilDeadline(record, now) : null,
      saved: savedById.get(opportunityId) ?? null,
      application: applicationById.get(opportunityId) ?? null,
    };
  };

  const applicationItems = applications.map((a) => item(a.opportunityId)).sort(comparePlanItems);
  const savedItems = saved.map((s) => item(s.opportunityId)).sort(comparePlanItems);
  const all = new Map([...applicationItems, ...savedItems].map((i) => [i.opportunityId, i] as const));
  const live = [...all.values()];

  return {
    applications: applicationItems,
    saved: savedItems,
    stats: {
      applications: applicationItems.length,
      saved: savedItems.length,
      // "Closing soon" only counts things the person can still act on.
      closingSoon: live.filter((i) => i.state === "closing_soon" && !(i.application && FINAL_STATUSES.includes(i.application.status))).length,
      expired: live.filter((i) => i.state === "expired").length,
    },
  };
}

export const filterByStatus = (items: PlanItem[], status: ApplicationStatus | null) =>
  status ? items.filter((i) => i.application?.status === status) : items;
