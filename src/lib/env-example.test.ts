import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkProductionEnv } from "./preflight";

/** Keeps .env.example COMPLETE: every variable the code reads must be documented there. */
const ROOT = process.cwd();
const walk = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((n) => {
    const rel = join(dir, n);
    return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : /\.(ts|tsx|mjs)$/.test(rel) && !/\.test\./.test(rel) ? [rel] : [];
  });

const used = new Set<string>();
for (const file of [...walk("src"), ...walk("scripts"), "next.config.ts"]) {
  for (const m of readFileSync(join(ROOT, file), "utf8").matchAll(/\b(?:process\.env|env)\.([A-Z][A-Z0-9_]{2,})\b/g)) used.add(m[1]!);
}
const example = readFileSync(join(ROOT, ".env.example"), "utf8");
const BUILT_IN = new Set(["NODE_ENV"]); // set by Node / Next.js, not by us

describe(".env.example", () => {
  it("finds the variables the code reads (sanity check of this test)", () => {
    for (const name of ["NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_SUPABASE_URL", "ANTHROPIC_API_KEY", "SHOW_DEMO_CONTENT", "VERCEL_ENV"]) expect(used, name).toContain(name);
  });

  it("documents every variable the code reads", () => {
    const missing = [...used].filter((n) => !BUILT_IN.has(n) && !new RegExp(`^#?\\s*${n}\\b`, "m").test(example) && !example.includes(n));
    expect(missing).toEqual([]);
  });

  it("contains placeholders only: no real-looking secret values", () => {
    const active = example.split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.slice(l.indexOf("=") + 1));
    for (const v of active) expect(v, v).not.toMatch(/^eyJ|^sk-|^sb_(secret|publishable)_|[A-Za-z0-9+/]{40,}/);
  });

  it("does not activate any development-only switch or the unused service key", () => {
    for (const name of ["FAKE_AUTH", "FAKE_ADMIN_EMAILS", "AI_FAKE", "SUPABASE_SERVICE_ROLE_KEY", "TEST_DATABASE_URL"]) {
      expect(example, name).not.toMatch(new RegExp(`^${name}=`, "m"));
    }
  });

  it("is itself rejected by the production preflight (it is a template, not a production config)", () => {
    const env = Object.fromEntries(example.split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split("=")[0]!, l.slice(l.indexOf("=") + 1)]));
    expect(checkProductionEnv(env).some((f) => f.severity === "error")).toBe(true);
  });
});
