import type { Profile, ProfileInput } from "@/types/profile";

/**
 * Profile storage. EVERY operation is scoped to one user id, and with Supabase it additionally
 * runs under that user's own session, so row level security enforces "only your own profile"
 * in the database regardless of what this code does.
 */
export interface ProfileRepository {
  /** The user's profile, or null when they have not saved one yet. */
  get(userId: string): Promise<Profile | null>;
  /** Creates or replaces the profile fields of `userId`. Throws ProfileRepositoryError on failure. */
  save(userId: string, input: ProfileInput): Promise<Profile>;
}

export class ProfileRepositoryError extends Error {
  constructor(operation: string, readonly code?: string) {
    // Never include row data or the user's input in errors: profiles are private.
    super(`Profile ${operation} failed${code ? ` (${code})` : ""}`);
    this.name = "ProfileRepositoryError";
  }
}
