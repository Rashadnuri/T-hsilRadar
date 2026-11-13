import type { Application, ApplicationStatus, SavedOpportunity } from "@/types/plan";

/**
 * Private plan storage. Every method takes the id of the signed-in user (the server-verified
 * session user, never a value from the browser) and touches only that user's rows; row level
 * security enforces the same rule in the database.
 */
export interface PlanRepository {
  listSaved(userId: string): Promise<SavedOpportunity[]>;
  listApplications(userId: string): Promise<Application[]>;
  /** Idempotent: saving twice keeps one record. */
  save(userId: string, opportunityId: string): Promise<void>;
  unsave(userId: string, opportunityId: string): Promise<void>;
  /** Idempotent: returns the existing application when there already is one. */
  track(userId: string, opportunityId: string, status?: ApplicationStatus): Promise<Application>;
  /** Changes status and/or notes (`null` clears them). Returns null when there is no such application. */
  updateApplication(userId: string, opportunityId: string, changes: { status?: ApplicationStatus; notes?: string | null }): Promise<Application | null>;
  untrack(userId: string, opportunityId: string): Promise<void>;
}

export type PlanFailure = "not_visible" | "limit" | "failed";

/** Never carries notes or any row data: only the operation and a coarse reason. */
export class PlanRepositoryError extends Error {
  constructor(readonly operation: string, readonly reason: PlanFailure) {
    super(`plan ${operation} failed (${reason})`);
    this.name = "PlanRepositoryError";
  }
}
