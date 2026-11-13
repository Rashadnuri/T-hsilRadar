import type { QueryError, SupabaseLike } from "@/lib/supabase/types";
import type { Application, ApplicationStatus, SavedOpportunity } from "@/types/plan";
import { isApplicationStatus } from "@/types/plan";
import { PlanRepositoryError, type PlanFailure, type PlanRepository } from "./types";

const SAVED_COLUMNS = "id,opportunity_id,created_at";
const APPLICATION_COLUMNS = "id,opportunity_id,status,notes,status_changed_at,created_at,updated_at";

interface SavedRow { id: string; opportunity_id: string; created_at: string }
interface ApplicationRow { id: string; opportunity_id: string; status: string; notes: string | null; status_changed_at: string; created_at: string; updated_at: string }

export const mapSavedRow = (r: SavedRow): SavedOpportunity => ({ id: r.id, opportunityId: r.opportunity_id, createdAt: r.created_at });

export function mapApplicationRow(r: ApplicationRow): Application {
  return {
    id: r.id,
    opportunityId: r.opportunity_id,
    status: isApplicationStatus(r.status) ? r.status : "interested",
    notes: r.notes,
    statusChangedAt: r.status_changed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** SQLSTATE → coarse reason. 42501 = row level security refused (e.g. an opportunity the user cannot see). */
function reasonOf(error: QueryError): PlanFailure {
  if (error.code === "42501" || error.code === "23503") return "not_visible";
  if (error.code === "23514") return "limit";
  return "failed";
}

/**
 * The plan through Supabase, using the signed-in user's OWN session client: Postgres sees their
 * JWT, so the RLS policies decide what is visible. Filtering by user_id here is a second line of
 * defence and keeps the query indexed. Errors never include row contents (notes are private).
 */
export class SupabasePlanRepository implements PlanRepository {
  constructor(private readonly db: SupabaseLike) {}

  async listSaved(userId: string): Promise<SavedOpportunity[]> {
    const { data, error } = await this.db.from("saved_opportunities").select(SAVED_COLUMNS).eq("user_id", userId).order("created_at", { ascending: false });
    if (error) throw new PlanRepositoryError("listSaved", reasonOf(error));
    return ((data ?? []) as unknown as SavedRow[]).map(mapSavedRow);
  }

  async listApplications(userId: string): Promise<Application[]> {
    const { data, error } = await this.db.from("applications").select(APPLICATION_COLUMNS).eq("user_id", userId).order("updated_at", { ascending: false });
    if (error) throw new PlanRepositoryError("listApplications", reasonOf(error));
    return ((data ?? []) as unknown as ApplicationRow[]).map(mapApplicationRow);
  }

  async save(userId: string, opportunityId: string): Promise<void> {
    const { error } = await this.db
      .from("saved_opportunities")
      .upsert({ user_id: userId, opportunity_id: opportunityId }, { onConflict: "user_id,opportunity_id", ignoreDuplicates: true });
    if (error) throw new PlanRepositoryError("save", reasonOf(error));
  }

  async unsave(userId: string, opportunityId: string): Promise<void> {
    const { error } = await this.db.from("saved_opportunities").delete().eq("user_id", userId).eq("opportunity_id", opportunityId);
    if (error) throw new PlanRepositoryError("unsave", reasonOf(error));
  }

  async track(userId: string, opportunityId: string, status: ApplicationStatus = "interested"): Promise<Application> {
    const { error } = await this.db
      .from("applications")
      .upsert({ user_id: userId, opportunity_id: opportunityId, status }, { onConflict: "user_id,opportunity_id", ignoreDuplicates: true });
    if (error) throw new PlanRepositoryError("track", reasonOf(error));
    const application = await this.get(userId, opportunityId, "track");
    if (!application) throw new PlanRepositoryError("track", "failed");
    return application;
  }

  async updateApplication(userId: string, opportunityId: string, changes: { status?: ApplicationStatus; notes?: string | null }): Promise<Application | null> {
    const values: Record<string, unknown> = {};
    if (changes.status !== undefined) values.status = changes.status;
    if (changes.notes !== undefined) values.notes = changes.notes;
    if (Object.keys(values).length > 0) {
      const { error } = await this.db.from("applications").update(values).eq("user_id", userId).eq("opportunity_id", opportunityId);
      if (error) throw new PlanRepositoryError("updateApplication", reasonOf(error));
    }
    return this.get(userId, opportunityId, "updateApplication");
  }

  async untrack(userId: string, opportunityId: string): Promise<void> {
    const { error } = await this.db.from("applications").delete().eq("user_id", userId).eq("opportunity_id", opportunityId);
    if (error) throw new PlanRepositoryError("untrack", reasonOf(error));
  }

  private async get(userId: string, opportunityId: string, operation: string): Promise<Application | null> {
    const { data, error } = await this.db.from("applications").select(APPLICATION_COLUMNS).eq("user_id", userId).eq("opportunity_id", opportunityId).maybeSingle();
    if (error) throw new PlanRepositoryError(operation, reasonOf(error));
    return data ? mapApplicationRow(data as unknown as ApplicationRow) : null;
  }
}
