import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { AdminRepository, RoleRepository } from "@/repositories/admin/types";
import type { PlanRepository } from "@/repositories/plan/types";
import { ProfileRepositoryError, type ProfileRepository } from "@/repositories/profile/types";
import type { Profile, ProfileInput } from "@/types/profile";
import { authHintCookie, sessionCookieOptions } from "../cookies";
import type { AuthGateway, AuthUser, CookieJar } from "../types";
import { createFakeAdmin, createFakeRoles } from "./admin";
import { createFakePlan } from "./plan";
import { fakeState, MAX_FAILED_LOGINS, sendFakeMail, type FakeUser } from "./store";

/** DEVELOPMENT / TEST ONLY — see store.ts. Mimics the observable behaviour of Supabase Auth. */
export const FAKE_SESSION_COOKIE = "tr-fake-session";
const WEAK_PASSWORDS = new Set(["password1234", "1234567890", "qwertyuiop"]);

const hash = (password: string, salt: string) => scryptSync(password, salt, 32).toString("hex");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const toAuthUser = (u: FakeUser): AuthUser => ({ id: u.id, email: u.email, fullName: u.fullName, emailConfirmed: u.confirmed });
const withCode = (redirectTo: string, code: string) => `${redirectTo}${redirectTo.includes("?") ? "&" : "?"}code=${code}`;

export function createFakeAuth(jar: CookieJar): { auth: AuthGateway; profiles: ProfileRepository; plan: PlanRepository; roles: RoleRepository; admin: AdminRepository | null } {
  const sessionUser = (): FakeUser | null => {
    const id = jar.getAll().find((c) => c.name === FAKE_SESSION_COOKIE)?.value;
    const userId = id ? fakeState.sessions.get(id) : undefined;
    return userId ? (fakeState.users.get(userId) ?? null) : null;
  };
  const startSession = (user: FakeUser) => {
    const id = randomBytes(24).toString("hex");
    fakeState.sessions.set(id, user.id);
    jar.setAll([{ name: FAKE_SESSION_COOKIE, value: id, options: sessionCookieOptions() }]);
  };
  const confirmMode = () => process.env.FAKE_AUTH_CONFIRM_EMAIL === "1";

  const auth: AuthGateway = {
    async signUp({ email, password, fullName, redirectTo }) {
      if (WEAK_PASSWORDS.has(password)) return { ok: false, code: "weak_password" };
      const existing = fakeState.idByEmail.get(email);
      if (existing) {
        // Like Supabase: with confirmation on, an existing address looks like a normal sign-up.
        return confirmMode() ? { ok: true, data: { needsEmailConfirmation: true } } : { ok: false, code: "registration_failed" };
      }
      const salt = randomBytes(16).toString("hex");
      const user: FakeUser = { id: randomUUID(), email, fullName, salt, passwordHash: hash(password, salt), confirmed: !confirmMode() };
      fakeState.users.set(user.id, user);
      fakeState.idByEmail.set(email, user.id);
      if (user.confirmed) {
        startSession(user);
        return { ok: true, data: { needsEmailConfirmation: false } };
      }
      const code = randomBytes(16).toString("hex");
      fakeState.codes.set(code, { userId: user.id, purpose: "confirm" });
      sendFakeMail({ to: email, kind: "confirm", link: withCode(redirectTo, code) });
      return { ok: true, data: { needsEmailConfirmation: true } };
    },

    async signIn(email, password) {
      if ((fakeState.failures.get(email) ?? 0) >= MAX_FAILED_LOGINS) return { ok: false, code: "rate_limited" };
      const user = fakeState.users.get(fakeState.idByEmail.get(email) ?? "");
      if (!user || !same(hash(password, user.salt), user.passwordHash)) {
        fakeState.failures.set(email, (fakeState.failures.get(email) ?? 0) + 1);
        return { ok: false, code: "invalid_credentials" }; // identical for unknown e-mail and wrong password
      }
      if (!user.confirmed) return { ok: false, code: "email_not_confirmed" };
      fakeState.failures.delete(email);
      startSession(user);
      return { ok: true, data: toAuthUser(user) };
    },

    async signOut() {
      const id = jar.getAll().find((c) => c.name === FAKE_SESSION_COOKIE)?.value;
      if (id) fakeState.sessions.delete(id);
      jar.setAll([{ name: FAKE_SESSION_COOKIE, value: "", options: { ...sessionCookieOptions(), maxAge: 0 } }, authHintCookie(false)]);
      return { ok: true, data: undefined };
    },

    async requestPasswordReset(email, redirectTo) {
      const userId = fakeState.idByEmail.get(email);
      if (userId) {
        const code = randomBytes(16).toString("hex");
        fakeState.codes.set(code, { userId, purpose: "recover" });
        sendFakeMail({ to: email, kind: "recover", link: withCode(redirectTo, code) });
      }
      return { ok: true, data: undefined }; // same answer whether or not the account exists
    },

    async exchangeCode(code) {
      const entry = fakeState.codes.get(code);
      const user = entry && fakeState.users.get(entry.userId);
      if (!entry || !user) return { ok: false, code: "invalid_link" };
      fakeState.codes.delete(code); // one-time
      user.confirmed = true;
      startSession(user);
      return { ok: true, data: toAuthUser(user) };
    },

    async updatePassword(password) {
      const user = sessionUser();
      if (!user) return { ok: false, code: "session_missing" };
      if (WEAK_PASSWORDS.has(password)) return { ok: false, code: "weak_password" };
      if (same(hash(password, user.salt), user.passwordHash)) return { ok: false, code: "same_password" };
      user.salt = randomBytes(16).toString("hex");
      user.passwordHash = hash(password, user.salt);
      return { ok: true, data: undefined };
    },

    async getUser() {
      const user = sessionUser();
      return user ? toAuthUser(user) : null;
    },
    async hasSession() {
      return sessionUser() !== null;
    },
  };

  const profiles: ProfileRepository = {
    async get(userId) {
      return fakeState.profiles.get(userId) ?? null;
    },
    async save(userId, input: ProfileInput): Promise<Profile> {
      if (!fakeState.users.has(userId)) throw new ProfileRepositoryError("save", "23503");
      const now = new Date().toISOString();
      const previous = fakeState.profiles.get(userId);
      const profile: Profile = { ...input, id: userId, createdAt: previous?.createdAt ?? now, updatedAt: now };
      fakeState.profiles.set(userId, profile);
      return profile;
    },
  };

  const user = sessionUser();
  return { auth, profiles, plan: createFakePlan(), roles: createFakeRoles(), admin: user ? createFakeAdmin(user.id) : null };
}
