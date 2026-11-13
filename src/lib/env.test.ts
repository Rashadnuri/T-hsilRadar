import { describe, expect, it } from "vitest";
import { getServiceRoleKey, getSupabasePublicConfig, isDemoContentEnabled, isSupabaseConfigured } from "./env";

describe("getSupabasePublicConfig", () => {
  it("is null when Supabase is not configured (the app then serves the labelled demo data)", () => {
    expect(getSupabasePublicConfig({})).toBeNull();
    expect(isSupabaseConfigured({})).toBe(false);
  });
  it("treats values copied from .env.example as NOT configured", () => {
    expect(getSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://your-project-ref.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "your-anon-key" })).toBeNull();
  });
  it("returns the config, trimming and dropping a trailing slash", () => {
    expect(getSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: " https://abc.supabase.co/ ", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-value" })).toEqual({ url: "https://abc.supabase.co", anonKey: "anon-key-value" });
  });
  it("fails loudly when only half configured (never silently falls back to demo in a broken production)", () => {
    expect(() => getSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" })).toThrow(/BOTH/);
    expect(() => getSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })).toThrow(/BOTH/);
  });
  it("rejects invalid URLs and non-https remote URLs, but allows http for localhost", () => {
    expect(() => getSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: "not a url", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })).toThrow(/valid URL/);
    expect(() => getSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: "http://abc.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })).toThrow(/https/);
    expect(getSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })?.url).toBe("http://127.0.0.1:54321");
  });
});

describe("other settings", () => {
  it("demo content is on unless explicitly disabled", () => {
    expect(isDemoContentEnabled({})).toBe(true);
    expect(isDemoContentEnabled({ SHOW_DEMO_CONTENT: "true" })).toBe(true);
    expect(isDemoContentEnabled({ SHOW_DEMO_CONTENT: "false" })).toBe(false);
    // unset: visible while developing, hidden in a production build (a forgotten variable must not show demo data)
    expect(isDemoContentEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isDemoContentEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(isDemoContentEnabled({ NODE_ENV: "production", SHOW_DEMO_CONTENT: "true" })).toBe(true); // explicit opt-in (e.g. Vercel previews)
    expect(isDemoContentEnabled({ NODE_ENV: "production", SHOW_DEMO_CONTENT: " FALSE " })).toBe(false);
    expect(isDemoContentEnabled({ NODE_ENV: "production", SHOW_DEMO_CONTENT: "yes" })).toBe(false); // anything unclear fails closed in production
  });
  it("the service-role key is null when unset or a placeholder", () => {
    expect(getServiceRoleKey({})).toBeNull();
    expect(getServiceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: "your-service-role-key" })).toBeNull();
    expect(getServiceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: "real-looking-secret-value" })).toBe("real-looking-secret-value");
  });
});
