import { randomUUID } from "node:crypto";
import { PlanRepositoryError, type PlanRepository } from "@/repositories/plan/types";
import { PLAN_LIMITS, type Application, type ApplicationStatus } from "@/types/plan";
import { fakeState } from "./store";

/**
 * DEVELOPMENT / TEST ONLY: the plan repository over memory. It mirrors the database rules the
 * real tables enforce: one saved record and one application per (user, opportunity), owner-only
 * access, a per-user cap, and "status_changed_at only moves when the status changes".
 */
const key = (userId: string, opportunityId: string) => `${userId}|${opportunityId}`;
const mine = <T extends { opportunityId: string }>(map: Map<string, T>, userId: string): T[] =>
  [...map.entries()].filter(([k]) => k.startsWith(`${userId}|`)).map(([, v]) => v);

export function createFakePlan(): PlanRepository {
  const { saved, applications } = fakeState;
  const requireUser = (userId: string, operation: string) => {
    if (!fakeState.users.has(userId)) throw new PlanRepositoryError(operation, "not_visible");
  };
  return {
    async listSaved(userId) {
      return mine(saved, userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async listApplications(userId) {
      return mine(applications, userId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async save(userId, opportunityId) {
      requireUser(userId, "save");
      if (saved.has(key(userId, opportunityId))) return;
      if (mine(saved, userId).length >= PLAN_LIMITS.perUserMax) throw new PlanRepositoryError("save", "limit");
      saved.set(key(userId, opportunityId), { id: randomUUID(), opportunityId, createdAt: new Date().toISOString() });
    },
    async unsave(userId, opportunityId) {
      saved.delete(key(userId, opportunityId));
    },
    async track(userId, opportunityId, status: ApplicationStatus = "interested") {
      requireUser(userId, "track");
      const existing = applications.get(key(userId, opportunityId));
      if (existing) return existing;
      if (mine(applications, userId).length >= PLAN_LIMITS.perUserMax) throw new PlanRepositoryError("track", "limit");
      const now = new Date().toISOString();
      const created: Application = { id: randomUUID(), opportunityId, status, notes: null, statusChangedAt: now, createdAt: now, updatedAt: now };
      applications.set(key(userId, opportunityId), created);
      return created;
    },
    async updateApplication(userId, opportunityId, changes) {
      const current = applications.get(key(userId, opportunityId));
      if (!current) return null;
      const now = new Date().toISOString();
      const next: Application = {
        ...current,
        status: changes.status ?? current.status,
        notes: changes.notes === undefined ? current.notes : changes.notes,
        statusChangedAt: changes.status !== undefined && changes.status !== current.status ? now : current.statusChangedAt,
        updatedAt: now,
      };
      applications.set(key(userId, opportunityId), next);
      return next;
    },
    async untrack(userId, opportunityId) {
      applications.delete(key(userId, opportunityId));
    },
  };
}
