import "server-only";
import { notFound } from "next/navigation";
import type { Locale } from "@/i18n/routing";
import type { AdminRepository } from "@/repositories/admin/types";
import { getAuthContext, requireUser } from "./session";
import type { AuthUser } from "./types";

/**
 * The authoritative admin check for pages (the proxy only does an optimistic redirect for
 * signed-out visitors). Order: signed in (→ login, in the visitor's language) → role read from the
 * database → anything but admin gets a 404, so the area does not even confirm that it exists.
 * Every server action re-checks via `authorize` in features/admin/handlers.ts.
 */
export async function requireAdmin(locale: Locale, next: string): Promise<{ user: AuthUser; admin: AdminRepository }> {
  const user = await requireUser(locale, next);
  const { roles, admin } = await getAuthContext();
  let isAdmin = false;
  try {
    isAdmin = roles ? (await roles.getRoles(user.id)).includes("admin") : false;
  } catch {
    isAdmin = false; // fail closed
  }
  if (!isAdmin || !admin) notFound();
  return { user, admin: admin as AdminRepository };
}
