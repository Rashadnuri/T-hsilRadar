import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Application, SavedOpportunity } from "@/types/plan";
import type { Profile } from "@/types/profile";

/**
 * DEVELOPMENT / TEST ONLY. An in-memory stand-in for Supabase Auth so the whole UI can be run
 * and browser-tested where no auth server exists. It must never run in production.
 */
if (process.env.NODE_ENV === "production") {
  throw new Error("The fake auth backend must never be loaded in production.");
}

export interface FakeUser {
  id: string;
  email: string;
  fullName: string;
  salt: string;
  passwordHash: string;
  confirmed: boolean;
}
export interface FakeState {
  users: Map<string, FakeUser>;
  idByEmail: Map<string, string>;
  /** session id → user id */
  sessions: Map<string, string>;
  /** one-time email codes */
  codes: Map<string, { userId: string; purpose: "confirm" | "recover" }>;
  failures: Map<string, number>;
  profiles: Map<string, Profile>;
  /** `${userId}|${opportunityId}` → record */
  saved: Map<string, SavedOpportunity>;
  applications: Map<string, Application>;
}

const KEY = Symbol.for("tahsilradar.fake-auth-state");
const holder = globalThis as unknown as Record<symbol, FakeState | undefined>;

/** Survives hot reloads: kept on globalThis. */
export const fakeState: FakeState = (holder[KEY] ??= {
  users: new Map(), idByEmail: new Map(), sessions: new Map(), codes: new Map(), failures: new Map(), profiles: new Map(), saved: new Map(), applications: new Map(),
});
// A state object that survived a hot reload from before the plan existed.
fakeState.saved ??= new Map();
fakeState.applications ??= new Map();

export const MAX_FAILED_LOGINS = 5;

/** Emails are "sent" to a JSON-lines file so browser tests can read the links. */
export function sendFakeMail(message: { to: string; kind: "confirm" | "recover"; link: string }): void {
  const file = process.env.FAKE_AUTH_MAILBOX_FILE ?? join(tmpdir(), "tahsilradar-fake-mailbox.jsonl");
  appendFileSync(file, `${JSON.stringify({ ...message, at: new Date().toISOString() })}\n`);
}
