import type { AuthGateway } from "./types";

const unavailable = { ok: false, code: "not_configured" } as const;

/** Used when neither Supabase nor the dev-only fake is configured: every operation fails cleanly. */
export const unconfiguredGateway: AuthGateway = {
  signUp: async () => unavailable,
  signIn: async () => unavailable,
  signOut: async () => ({ ok: true, data: undefined }),
  requestPasswordReset: async () => unavailable,
  exchangeCode: async () => unavailable,
  updatePassword: async () => unavailable,
  getUser: async () => null,
  hasSession: async () => false,
};
