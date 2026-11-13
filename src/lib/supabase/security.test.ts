import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guards for the repository itself (SECURITY.md §8): secrets stay out of the browser and
 * out of git, the service-role client stays isolated, and every table gets row level security.
 */
const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function walk(dir: string, accept: (file: string) => boolean, skip = ["node_modules", ".next", ".git", "coverage"]): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    if (skip.includes(name)) return [];
    const rel = join(dir, name);
    return statSync(join(ROOT, rel)).isDirectory() ? walk(rel, accept, skip) : accept(rel) ? [rel] : [];
  });
}
const sources = [...walk("src", (f) => /\.(ts|tsx)$/.test(f)), ...walk("supabase", (f) => /\.ts$/.test(f)), ...walk("scripts", (f) => /\.(ts|mjs)$/.test(f))];

describe(".env.example and git hygiene", () => {
  const example = read(".env.example");
  const values = Object.fromEntries(example.split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split("=")[0]!, l.slice(l.indexOf("=") + 1)] as const));

  it("documents every Supabase variable with a PLACEHOLDER (never a real value)", () => {
    expect(values.NEXT_PUBLIC_SUPABASE_URL).toMatch(/your-project-ref/);
    expect(values.NEXT_PUBLIC_SUPABASE_ANON_KEY).toMatch(/^your-/);
    // The application does not use the service-role key, so it is documented only as a COMMENTED, server-only entry
    // (nobody should fill it in by copying the file).
    expect(values).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");
    expect(example).toMatch(/^# SUPABASE_SERVICE_ROLE_KEY=/m);
    expect(example).toMatch(/do\s+NOT set it in Vercel/i);
  });
  it("the service-role key is never exposed through a NEXT_PUBLIC_ variable", () => {
    expect(Object.keys(values).filter((k) => k.startsWith("NEXT_PUBLIC_") && /SERVICE|SECRET/i.test(k))).toEqual([]);
  });
  it(".env.local and other env files are git-ignored; only .env.example is not", () => {
    const ignore = read(".gitignore").split("\n").map((l) => l.trim());
    expect(ignore).toContain(".env");
    expect(ignore).toContain(".env.*");
    expect(ignore).toContain("!.env.example");
    expect(ignore.some((l) => /^supabase\/\.(temp|branches)/.test(l))).toBe(true);
  });
  it("no JWT, Supabase key or private key is committed anywhere in the project files", () => {
    const patterns = [/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\./, /sb_secret_[A-Za-z0-9]{8,}/, /sbp_[a-f0-9]{30,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
    const files = [".env.example", "README.md", "package.json", ...walk("src", () => true), ...walk("supabase", () => true), ...walk("scripts", () => true), ...walk(".", (f) => /\.md$/.test(f) && !f.includes("/"))];
    const hits = files.filter((f) => existsSync(join(ROOT, f)) && statSync(join(ROOT, f)).isFile() && patterns.some((p) => p.test(read(f))));
    expect(hits).toEqual([]);
  });
  it("there is no committed .env.local", () => {
    // (the file may exist on a developer machine; it is ignored by git, which the test above verifies)
    expect(read(".gitignore")).toContain(".env.*");
  });
});

describe("the service-role key and client stay on the server", () => {
  // The preflight reads only the NAME (to warn that an unused key is set); its report never contains values (tested).
  const ALLOWED_KEY_REFERENCES = new Set(["src/lib/env.ts", "src/lib/env.test.ts", "src/lib/supabase/admin.ts", "src/lib/supabase/security.test.ts", "src/lib/preflight.ts", "src/lib/preflight.test.ts", "src/lib/env-example.test.ts"]);

  it("SUPABASE_SERVICE_ROLE_KEY is referenced only in the env module, the admin client and tests", () => {
    const users = sources.filter((f) => read(f).includes("SUPABASE_SERVICE_ROLE_KEY"));
    expect(users.filter((f) => !ALLOWED_KEY_REFERENCES.has(f))).toEqual([]);
  });
  it("no NEXT_PUBLIC_ name mentions a service/secret key anywhere", () => {
    expect(sources.filter((f) => /NEXT_PUBLIC_[A-Z_]*(SERVICE|SECRET)/.test(read(f)) && !["src/lib/supabase/security.test.ts", "src/lib/preflight.test.ts"].includes(f))).toEqual([]); // preflight.test.ts holds deliberate NEGATIVE examples
  });
  it("server-side Supabase modules are marked server-only", () => {
    for (const f of ["src/lib/supabase/server.ts", "src/lib/supabase/admin.ts"]) expect(read(f)).toMatch(/^import "server-only";/m);
  });
  it("nothing imports the service-role client yet (admin writes arrive with the admin phase)", () => {
    const importers = sources.filter((f) => f !== "src/lib/supabase/admin.ts" && /@\/lib\/supabase\/admin/.test(read(f)));
    expect(importers).toEqual([]);
  });
  it("no client component imports Supabase, repositories, services or the env module", () => {
    const clientFiles = sources.filter((f) => /^\s*["']use client["']/.test(read(f).split("\n").slice(0, 3).join("\n")));
    expect(clientFiles.length).toBeGreaterThan(5);
    const offenders = clientFiles.filter((f) => /from "(@supabase\/supabase-js|@\/lib\/supabase\/[^"]+|@\/repositories[^"]*|@\/services[^"]*|@\/lib\/env)"/.test(read(f)));
    expect(offenders).toEqual([]);
  });
  it("only the server-side data layer imports supabase-js", () => {
    const users = sources.filter((f) => !f.endsWith(".test.ts") && read(f).includes('"@supabase/supabase-js"'));
    expect(users.sort()).toEqual(["src/lib/auth/supabase-gateway.ts", "src/lib/supabase/admin.ts", "src/lib/supabase/server.ts"]);
  });
});

describe("authentication stays on the server", () => {
  it("no client component imports the server auth layer (session DAL, gateways, fake backend)", () => {
    const clientFiles = sources.filter((f) => /^\s*["']use client["']/.test(read(f).split("\n").slice(0, 3).join("\n")));
    const offenders = clientFiles.filter((f) => /from "@\/lib\/auth\/(session|index|supabase-gateway|next-cookies|fake[^"]*)"/.test(read(f)));
    expect(offenders).toEqual([]);
  });
  it("server actions and the session DAL are server-only", () => {
    expect(read("src/features/auth/actions.ts")).toMatch(/^"use server";/m);
    expect(read("src/lib/auth/session.ts")).toMatch(/^import "server-only";/m);
  });
  it("the fake auth backend can never run in production", () => {
    expect(read("src/lib/auth/mode.ts")).toMatch(/NODE_ENV !== "production"/);
  });
  it("the private pages are protected by the server-side check and never indexed", () => {
    for (const file of ["src/app/[locale]/profile/page.tsx", "src/app/[locale]/my-plan/page.tsx"]) {
      const page = read(file);
      expect(page, file).toMatch(/requireUser\(/);
      expect(page, file).toMatch(/noindex: true/);
    }
  });
  it("plan server actions never accept a user id from the browser", () => {
    const actions = read("src/features/plan/actions.ts");
    expect(actions).toMatch(/^"use server";/m);
    expect(actions).not.toMatch(/userId|user_id/);
    const handlers = read("src/features/plan/handlers.ts");
    expect(handlers).not.toMatch(/form\.get\(["']user/i);
  });
  it("the plan state endpoint is dynamic, uncached and returns 401 without a session", () => {
    const route = read("src/app/api/my-plan/state/route.ts");
    expect(route).toMatch(/force-dynamic/);
    expect(route).toMatch(/no-store/);
    expect(route).toMatch(/401/);
  });
});

describe("AI and matching stay safe", () => {
  const aiFiles = sources.filter((f) => f.startsWith("src/lib/ai/") && !f.endsWith(".test.ts"));
  it("the provider key is read only by the AI config module and never by client code", () => {
    const readers = sources.filter((f) => !f.endsWith(".test.ts") && /ANTHROPIC_API_KEY/.test(read(f)));
    // preflight.ts is a CLI-only checker (see the guard below): it validates the key's prefix and never outputs it.
    expect(readers).toEqual(["src/lib/ai/config.ts", "src/lib/preflight.ts"]);
    expect(sources.filter((f) => /NEXT_PUBLIC_[A-Z_]*(ANTHROPIC|AI_)/.test(read(f)) && !f.endsWith(".test.ts"))).toEqual([]);
    const clientFiles = sources.filter((f) => /^\s*["']use client["']/.test(read(f).split("\n").slice(0, 3).join("\n")));
    expect(clientFiles.filter((f) => /@\/lib\/ai\/(config|llm|service|server|facts|prompt|sanitize|fake-llm|rate-limit)|@anthropic-ai\/sdk/.test(read(f)))).toEqual([]);
  });
  it("only llm.ts imports the Anthropic SDK", () => {
    expect(sources.filter((f) => !f.endsWith(".test.ts") && read(f).includes("@anthropic-ai/sdk"))).toEqual(["src/lib/ai/llm.ts"]);
  });
  it("the AI module has no write path: no repositories, no service-role client, no tools in requests", () => {
    for (const f of aiFiles) {
      expect(read(f), f).not.toMatch(/@\/repositories|supabase\/admin|SERVICE_ROLE/);
    }
    expect(read("src/lib/ai/llm.ts")).not.toMatch(/\btools\s*:/);
  });
  it("the fake LLM and fake auth cannot run in production", () => {
    expect(read("src/lib/ai/fake-llm.ts")).toMatch(/NODE_ENV === "production"\) throw/);
    expect(read("src/lib/ai/config.ts")).toMatch(/NODE_ENV !== "production"/);
  });
  it("the AI route checks origin and session before reading the body", () => {
    const route = read("src/app/api/ai/opportunity/route.ts");
    const at = (needle: string) => route.indexOf(needle);
    expect(at("isSameOrigin(request)")).toBeGreaterThan(-1);
    expect(at("isSameOrigin(request)")).toBeLessThan(at("auth.getUser()"));
    expect(at("auth.getUser()")).toBeLessThan(at("readJsonBody(request)"));
  });
  it("the matching engine is pure: no network, database, env or AI imports", () => {
    for (const f of sources.filter((x) => x.startsWith("src/lib/matching/") && !x.endsWith(".test.ts"))) expect(read(f), f).not.toMatch(/fetch\(|process\.env|@\/lib\/ai|@\/repositories|supabase/);
  });
  it("matches and plan pages are protected and not indexed", () => {
    expect(read("src/app/[locale]/matches/page.tsx")).toMatch(/requireUser\(/);
    expect(read("src/app/[locale]/matches/page.tsx")).toMatch(/noindex: true/);
  });
});

describe("the admin area is protected on the server", () => {
  const adminPages = sources.filter((f) => /^src\/app\/\[locale\]\/admin\/.*page\.tsx$/.test(f));
  it("has the admin routes", () => {
    expect(adminPages.sort()).toEqual([
      "src/app/[locale]/admin/import/page.tsx",
      "src/app/[locale]/admin/opportunities/[id]/edit/page.tsx",
      "src/app/[locale]/admin/opportunities/new/page.tsx",
      "src/app/[locale]/admin/opportunities/page.tsx",
      "src/app/[locale]/admin/organizations/page.tsx",
      "src/app/[locale]/admin/page.tsx",
      "src/app/[locale]/admin/quality/page.tsx",
      "src/app/[locale]/admin/sources/page.tsx",
    ]);
  });
  it("every admin page checks the admin role itself (a layout is not enough) and is never indexed", () => {
    for (const f of adminPages) {
      const page = read(f);
      expect(page, f).toMatch(/requireAdmin\(/);
      expect(page, f).toMatch(/noindex: true/);
      // the check runs at the top of the page component, before any admin data is read
      const body = page.slice(page.indexOf("export default async function Page"));
      expect(body.indexOf("requireAdmin("), f).toBeGreaterThan(-1);
      expect(body.indexOf("requireAdmin("), f).toBeLessThan(body.indexOf("admin."));
    }
    expect(sources.filter((f) => /^src\/app\/\[locale\]\/admin\/(.*\/)?layout\.tsx$/.test(f))).toEqual([]); // a layout would also frame the 404 shown to non-admins
  });
  it("every admin handler authorizes before doing anything else", () => {
    const handlers = read("src/features/admin/handlers.ts");
    const chunks = handlers.split("export async function ").slice(1).filter((c) => c.startsWith("handle"));
    expect(chunks.length).toBeGreaterThanOrEqual(7);
    for (const chunk of chunks) {
      const name = chunk.slice(0, chunk.indexOf("("));
      expect(chunk.slice(chunk.indexOf("await ")).startsWith("await authorize(ctx)"), name).toBe(true); // the FIRST thing a handler awaits
    }
  });
  it("import handlers authorize first, too; import actions only call handlers", () => {
    const chunks = read("src/features/admin/import-handlers.ts").split("export async function ").slice(1).filter((c) => c.startsWith("handle"));
    expect(chunks.length).toBeGreaterThanOrEqual(6);
    for (const chunk of chunks) expect(chunk.slice(chunk.indexOf("await ")).startsWith("await authorize(ctx)"), chunk.slice(0, 30)).toBe(true);
    const actions = read("src/features/admin/import-actions.ts");
    expect(actions).toMatch(/^"use server";/m);
    expect(actions).not.toMatch(/\.save\(|\.saveSource|\.removeSource|from\("/);
  });
  it("the import library never makes a network request (no scraping, no SSRF) and the template endpoint is admin-only", () => {
    for (const f of sources.filter((x) => x.startsWith("src/lib/import/") && !x.endsWith(".test.ts"))) expect(read(f), f).not.toMatch(/\bfetch\(|XMLHttpRequest|node:http|node:https|node:net|axios/);
    expect(read("src/features/admin/import-handlers.ts")).not.toMatch(/\bfetch\(/);
    const route = read("src/app/api/admin/import-template/route.ts");
    expect(route).toMatch(/authorize\(/);
    expect(route).toMatch(/no-store/);
  });
  it("admin server actions only call the handlers (no data access of their own)", () => {
    const actions = read("src/features/admin/actions.ts");
    expect(actions).toMatch(/^"use server";/m);
    expect(actions).not.toMatch(/\.save\(|\.setPublicationStatus|\.remove\(|from\("/);
  });
  it("authorize reads the role from the role store and fails closed", () => {
    const handlers = read("src/features/admin/handlers.ts");
    expect(handlers).toMatch(/getRoles\(user\.id\)/);
    expect(handlers).toMatch(/fail closed/);
  });
  it("roles are never written by application code, and the service-role client is not used by the admin area", () => {
    const code = sources.filter((f) => !f.endsWith(".test.ts"));
    expect(code.filter((f) => /from\("user_roles"\)\s*\.(insert|upsert|update|delete)/.test(read(f)))).toEqual([]);
    expect(code.filter((f) => f.startsWith("src/features/admin/") || f.startsWith("src/repositories/admin/")).filter((f) => /supabase\/admin|SERVICE_ROLE/.test(read(f)))).toEqual([]);
  });
  it("no client component imports the server-side admin check or data layer", () => {
    const clientFiles = sources.filter((f) => /^\s*["']use client["']/.test(read(f).split("\n").slice(0, 3).join("\n")));
    expect(clientFiles.filter((f) => /@\/lib\/auth\/admin|@\/repositories\/admin|fake\/admin/.test(read(f)))).toEqual([]);
  });
  it("the in-memory admin backend is development-only", () => {
    expect(read("src/lib/auth/fake/store.ts")).toMatch(/NODE_ENV === "production"/);
    expect(read("src/lib/auth/fake/admin.ts")).toMatch(/FAKE_ADMIN_EMAILS/);
  });
  it("admin pages are protected by the proxy (optimistic) and sent with private, no-store headers", () => {
    expect(read("src/proxy.ts")).toMatch(/profile\|my-plan\|matches\|admin/);
    expect(read("next.config.ts")).toMatch(/matches\|admin/);
  });
});

describe("migrations", () => {
  const files = walk("supabase/migrations", (f) => f.endsWith(".sql")).sort();
  const sql = files.map((f) => read(f)).join("\n");
  const noComments = sql.replace(/--.*$/gm, "");

  it("are timestamp-named and applied in order", () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const f of files) expect(relative("supabase/migrations", f)).toMatch(/^\d{14}_[a-z_]+\.sql$/);
  });
  it("every table created in the public schema has row level security enabled", () => {
    const created = [...noComments.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]!);
    expect(created.sort()).toEqual(["admin_audit_log", "applications", "categories", "cities", "opportunities", "opportunity_categories", "opportunity_sources", "opportunity_translations", "organizations", "profiles", "saved_opportunities", "user_roles"]);
    for (const table of created) expect(noComments, table).toMatch(new RegExp(`alter table public\\.${table}\\s+enable row level security`));
  });
  it("never disable RLS, never use SECURITY DEFINER, never grant write access to public roles", () => {
    expect(noComments).not.toMatch(/disable row level security/i);
    expect(noComments).not.toMatch(/security\s+definer/i);
    // Only the owner-scoped profiles table may be written by `authenticated` (column-level grants, never anon, never delete).
    for (const grant of noComments.match(/grant [^;]*? to [^;]*?;/gis) ?? []) {
      if (!/\b(anon|authenticated)\b/i.test(grant)) continue;
      const PRIVATE_TABLE = /\bon\s+(table\s+)?public\.(profiles|saved_opportunities|applications)\b/i;
      if (PRIVATE_TABLE.test(grant)) {
        // Private per-user tables: never anon, never truncate/all; profiles can additionally never be deleted by the user.
        expect(grant, grant).not.toMatch(/\b(anon|truncate|all)\b/i);
        if (/public\.profiles/i.test(grant)) expect(grant, grant).not.toMatch(/\bdelete\b/i);
        continue;
      }
      // Roles are written ONLY by the operator: no write privilege for any API role, ever.
      if (/public\.user_roles/i.test(grant)) {
        expect(grant, grant).not.toMatch(/\b(insert|update|delete|truncate|all)\b/i);
        continue;
      }
      // Admin-managed tables: `authenticated` may be granted writes (never anon, never truncate/all); the policies decide WHO (see below).
      if (/\bon\s+(table\s+)?public\.(opportunities|opportunity_translations|organizations|opportunity_categories|opportunity_sources|admin_audit_log)\b/i.test(grant)) {
        const verbs = grant.split(/\bon\b/i)[0] ?? "";
        if (!/\b(insert|update|delete|truncate|all)\b/i.test(verbs)) continue; // read grants (the public catalogue) are fine
        expect(grant, grant).not.toMatch(/\b(anon|truncate|all)\b/i);
        if (/admin_audit_log/i.test(grant)) expect(grant, grant).not.toMatch(/\b(update|delete)\b/i);
        continue;
      }
      expect(grant, grant).not.toMatch(/\b(insert|update|delete|truncate|all)\b/i);
    }
  });
  it("define no policy for INSERT/UPDATE/DELETE/ALL", () => {
    for (const policy of noComments.match(/create policy [^;]*;/gis) ?? []) {
      if (/on public\.(opportunities|opportunity_translations|organizations|opportunity_categories|opportunity_sources|admin_audit_log)\b/i.test(policy) && !/for select/i.test(policy.split(/\bto\b/i)[0] ?? "")) {
        // Admin-only write policies on the catalogue: signed-in role, gated by is_admin(), never for anon, never FOR ALL.
        expect(policy).toMatch(/to authenticated/i);
        expect(policy).toMatch(/is_admin\(\)/i);
        expect(policy).not.toMatch(/for all/i);
      } else if (/on public\.user_roles\b/i.test(policy)) {
        expect(policy).toMatch(/for select/i); // roles: readable by their owner, writable by nobody through the API
        expect(policy).toMatch(/auth\.uid\(\)/i);
      } else if (/on public\.(profiles|saved_opportunities|applications)\b/i.test(policy)) {
        // Private per-user tables: owner-only, authenticated only, never public/anon, never FOR ALL.
        expect(policy).toMatch(/to authenticated/i);
        expect(policy).toMatch(/auth\.uid\(\)/i);
        expect(policy).not.toMatch(/for all/i);
        if (/on public\.profiles/i.test(policy)) expect(policy).not.toMatch(/for delete/i);
      } else expect(policy).toMatch(/for select/i);
    }
  });
  it("seed.sql is demo-only and not loaded by migrations", () => {
    expect(noComments).not.toMatch(/is_demo\s*,?\s*\)?\s*values|demo-/i);
    const seed = read("supabase/seed.sql");
    expect(seed).toMatch(/^-- DEMO SEED/);
    expect(seed).not.toMatch(/'verified'/);
  });
});

describe("HTTP security headers and robots (QA audit)", () => {
  const config = read("next.config.ts");

  it("sends nosniff, framing, referrer, permissions, HSTS and a partial CSP on every path", () => {
    for (const header of ["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy", "Strict-Transport-Security", "Content-Security-Policy"]) {
      expect(config, header).toContain(header);
    }
    expect(config).toContain("frame-ancestors 'none'");
    expect(config).toContain("object-src 'none'");
    expect(config).toMatch(/source: "\/:path\*"/);
  });

  it("session pages are never cacheable by shared caches", () => {
    expect(config).toMatch(/admin\|login[^"]*"[^}]*no-store/s);
  });

  it("does not advertise the framework", () => {
    expect(config).toContain("poweredByHeader: false");
  });
});

describe("modules that touch secrets cannot be bundled for the browser (QA audit)", () => {
  it.each(["src/lib/ai/config.ts", "src/lib/ai/llm.ts", "src/lib/ai/server.ts", "src/lib/supabase/admin.ts", "src/lib/supabase/server.ts", "src/lib/auth/admin.ts", "src/lib/auth/session.ts"])(
    "%s imports server-only",
    (file) => {
      expect(read(file)).toMatch(/^import "server-only";/m);
    },
  );

  it("no client component imports a secret-handling module (type imports are erased and fine)", () => {
    const secretModules = /from "@\/lib\/(ai\/(config|llm|server)|supabase\/(admin|server)|auth\/(admin|session))"/;
    const offenders = sources.filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f) && /^"use client"/.test(read(f)) && secretModules.test(read(f).replace(/import type [^\n]*\n/g, "")));
    expect(offenders).toEqual([]);
  });
});

describe("the production preflight stays out of the application", () => {
  it("is imported only by its CLI script and its tests, never by app code", () => {
    const importers = sources.filter((f) => /["']@\/lib\/preflight["']|["']\.\/preflight["']/.test(read(f)));
    expect(importers.sort()).toEqual(["scripts/preflight.ts", "src/lib/env-example.test.ts", "src/lib/preflight.test.ts"]);
  });
});
