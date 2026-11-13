import { describe, expect, it } from "vitest";
import { checkProductionEnv, hasErrors } from "./preflight";

// A syntactically JWT-like key whose payload says role=service_role / anon (not real keys).
const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.c2lnbmF0dXJl`;

const GOOD = {
  NEXT_PUBLIC_SITE_URL: "https://tahsilradar.az",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("anon"),
  SHOW_DEMO_CONTENT: "false",
};
const errors = (env: Record<string, string | undefined>) => checkProductionEnv(env).filter((f) => f.severity === "error").map((f) => f.subject);

describe("production preflight", () => {
  it("accepts a correct production environment (AI optional)", () => {
    expect(hasErrors(checkProductionEnv(GOOD))).toBe(false);
    expect(hasErrors(checkProductionEnv({ ...GOOD, ANTHROPIC_API_KEY: "sk-ant-api03-aaaa", AI_RATE_PER_MINUTE: "5" }))).toBe(false);
  });

  it("requires a public https origin as the site URL", () => {
    expect(errors({ ...GOOD, NEXT_PUBLIC_SITE_URL: undefined })).toContain("NEXT_PUBLIC_SITE_URL");
    for (const bad of ["http://tahsilradar.az", "https://localhost:3000", "https://tahsilradar.az/az", "not a url"]) {
      expect(errors({ ...GOOD, NEXT_PUBLIC_SITE_URL: bad }), bad).toContain("NEXT_PUBLIC_SITE_URL");
    }
  });

  it("requires Supabase (both values), https, hosted, and rejects placeholders", () => {
    expect(errors({ ...GOOD, NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined }).length).toBe(1);
    expect(errors({ ...GOOD, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined })).toContain("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(errors({ ...GOOD, NEXT_PUBLIC_SUPABASE_URL: "https://your-project-ref.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "your-anon-key" }).length).toBe(1);
    expect(errors({ ...GOOD, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).toContain("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("catches a service-role key placed in the public anon slot", () => {
    expect(errors({ ...GOOD, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("service_role") })).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(errors({ ...GOOD, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_abcdef" })).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });

  it("flags secrets exposed through NEXT_PUBLIC_ names and warns about the unused service key", () => {
    expect(errors({ ...GOOD, NEXT_PUBLIC_ANTHROPIC_API_KEY: "x" })).toContain("NEXT_PUBLIC_ANTHROPIC_API_KEY");
    expect(errors({ ...GOOD, NEXT_PUBLIC_SERVICE_ROLE_KEY: "x" })).toContain("NEXT_PUBLIC_SERVICE_ROLE_KEY");
    const f = checkProductionEnv({ ...GOOD, SUPABASE_SERVICE_ROLE_KEY: jwt("service_role") });
    expect(f.find((x) => x.subject === "SUPABASE_SERVICE_ROLE_KEY")?.severity).toBe("warning");
  });

  it("blocks demo content and every development-only switch", () => {
    expect(errors({ ...GOOD, SHOW_DEMO_CONTENT: "true" })).toContain("SHOW_DEMO_CONTENT");
    expect(hasErrors(checkProductionEnv({ ...GOOD, SHOW_DEMO_CONTENT: undefined }))).toBe(false); // hidden by default in production
    for (const name of ["FAKE_AUTH", "AI_FAKE", "FAKE_ADMIN_EMAILS", "FAKE_AUTH_CONFIRM_EMAIL"]) expect(errors({ ...GOOD, [name]: "1" }), name).toContain(name);
  });

  it("warns about malformed AI numbers and a key that does not look like Anthropic's", () => {
    const f = checkProductionEnv({ ...GOOD, ANTHROPIC_API_KEY: "wrong-key", AI_RATE_PER_DAY: "lots" });
    expect(f.filter((x) => x.severity === "warning").map((x) => x.subject).sort()).toEqual(["AI_RATE_PER_DAY", "ANTHROPIC_API_KEY", "NEXT_PUBLIC_CONTACT_EMAIL"]);
  });

  it("warns (never blocks) when the contact address is missing or unusable, and is silent when it is fine", () => {
    const contact = (v: string | undefined) => checkProductionEnv({ ...GOOD, NEXT_PUBLIC_CONTACT_EMAIL: v }).find((f) => f.subject === "NEXT_PUBLIC_CONTACT_EMAIL");
    expect(contact(undefined)?.severity).toBe("warning");
    expect(contact("name@example.com")?.severity).toBe("warning");
    expect(contact("info@tahsilradar.az")).toBeUndefined();
    expect(hasErrors(checkProductionEnv(GOOD))).toBe(false);
  });

  it("never puts a value into its report", () => {
    const secret = "SECRET-VALUE-9f3a";
    const text = JSON.stringify(checkProductionEnv({ ...GOOD, NEXT_PUBLIC_SUPABASE_ANON_KEY: secret, SUPABASE_SERVICE_ROLE_KEY: secret, ANTHROPIC_API_KEY: secret, NEXT_PUBLIC_SITE_URL: `https://${secret}.example` }));
    expect(text).not.toContain(secret);
  });
});
