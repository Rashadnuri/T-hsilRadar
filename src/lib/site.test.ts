import { describe, expect, it } from "vitest";
import { getSiteUrl, isIndexableDeployment, languageAlternates } from "./site";

describe("getSiteUrl", () => {
  it("prefers NEXT_PUBLIC_SITE_URL and strips trailing slashes", () => {
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://tahsilradar.az///" })).toBe("https://tahsilradar.az");
  });
  it("on Vercel production falls back to the production domain, on a preview to the deployment's own URL", () => {
    expect(getSiteUrl({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "tahsilradar.az", VERCEL_URL: "x-abc.vercel.app" })).toBe("https://tahsilradar.az");
    expect(getSiteUrl({ VERCEL_ENV: "preview", VERCEL_PROJECT_PRODUCTION_URL: "tahsilradar.az", VERCEL_URL: "x-abc.vercel.app" })).toBe("https://x-abc.vercel.app");
  });
  it("defaults to localhost", () => {
    expect(getSiteUrl({})).toBe("http://localhost:3000");
  });
});

describe("isIndexableDeployment", () => {
  it("only Vercel production is indexable", () => {
    expect(isIndexableDeployment({ VERCEL_ENV: "production" })).toBe(true);
    expect(isIndexableDeployment({ VERCEL_ENV: "preview" })).toBe(false);
    expect(isIndexableDeployment({ VERCEL_ENV: "development" })).toBe(false);
  });
  it("outside Vercel: a production build with a real domain is; localhost and dev are not", () => {
    expect(isIndexableDeployment({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://tahsilradar.az" })).toBe(true);
    expect(isIndexableDeployment({ NODE_ENV: "production" })).toBe(false);
    expect(isIndexableDeployment({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "http://localhost:3000" })).toBe(false);
    expect(isIndexableDeployment({ NODE_ENV: "development", NEXT_PUBLIC_SITE_URL: "https://tahsilradar.az" })).toBe(false);
  });
});

describe("languageAlternates", () => {
  it("lists every locale plus x-default = az", () => {
    expect(Object.keys(languageAlternates("/about")).sort()).toEqual(["az", "en", "ru", "x-default"]);
    expect(languageAlternates("/about")["x-default"]).toMatch(/\/az\/about$/);
  });
  it("lists only the available languages; x-default falls back to the first available one", () => {
    const only = languageAlternates("/opportunities/x", ["en", "ru"]);
    expect(Object.keys(only).sort()).toEqual(["en", "ru", "x-default"]);
    expect(only["x-default"]).toMatch(/\/en\/opportunities\/x$/);
    expect(languageAlternates("/x", [])).toEqual({});
  });
});
