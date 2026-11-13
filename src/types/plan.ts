/**
 * A user's PRIVATE plan (DATA_MODEL.md §17): bookmarks and application tracking. Every record
 * belongs to exactly one authenticated user; notes are never shown to anyone else.
 */

/** The order is the natural progress of an application (and the order of the status selector). */
export const APPLICATION_STATUSES = ["interested", "preparing", "applied", "interview", "accepted", "rejected", "withdrawn"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const isApplicationStatus = (value: unknown): value is ApplicationStatus =>
  typeof value === "string" && (APPLICATION_STATUSES as readonly string[]).includes(value);

/** Statuses after which nothing more is expected (used to de-emphasise finished applications). */
export const FINAL_STATUSES: readonly ApplicationStatus[] = ["accepted", "rejected", "withdrawn"];

export interface SavedOpportunity {
  id: string;
  opportunityId: string;
  createdAt: string;
}

export interface Application {
  id: string;
  opportunityId: string;
  status: ApplicationStatus;
  /** PRIVATE free text; null when empty. */
  notes: string | null;
  statusChangedAt: string;
  createdAt: string;
  updatedAt: string;
}

export const PLAN_LIMITS = { notesMax: 5000, perUserMax: 500 } as const;

/** What the signed-in visitor's browser needs to draw save/track buttons (ids only, no notes). */
export interface PlanSnapshot {
  saved: string[];
  applications: Record<string, ApplicationStatus>;
}
