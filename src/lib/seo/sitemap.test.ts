import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDemoRecords } from "@/features/opportunities/demo-data";
import type { OpportunityRecord } from "@/types/opportunity";
import { buildSitemap, STATIC_PATHS } from "./sitemap";

// Independent of the machine / CI environment: pin the site address and clear Vercel's variables.
const SITE = "https://tahsilradar.test";
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("VERCEL_URL", "");
});
afterEach(() => vi.unstubAllEnvs());

const demo = getDemoRecords();
const base = demo.find((o) => o.translations.length >= 3) ?? demo[0]!;
/** A real (non-demo) record with the given translations. */
const real = (slug: string, languages: ("az" | "ru" | "en")[]): OpportunityRecord => ({
  ...base,
  slug,
  isDemo: false,
  originalLanguage: languages[0]!,
  translations: languages.map((language, i) => ({ ...base.translations[0]!, language, status: i === 0 ? "original" : "human" })),
});

describe("buildSitemap", () => {
  it("lists the static pages in all 3 locales, each with hreflang alternates", () => {
    const urls = buildSitemap([]).map((e) => e.url);
    expect(urls).toHaveLength(STATIC_PATHS.length * 3);
    for (const path of STATIC_PATHS) for (const l of ["az", "ru", "en"]) expect(urls).toContain(`${SITE}/${l}${path}`);
    expect(buildSitemap([])[0]!.alternates?.languages).toHaveProperty("x-default");
  });

  it("NEVER lists demo records", () => {
    expect(buildSitemap(demo).map((e) => e.url).filter((u) => u.includes("/opportunities/"))).toEqual([]);
  });

  it("lists a real record in every language in which it is fully available, with lastModified", () => {
    const o = real("real-scholarship", ["az", "ru", "en"]);
    const entries = buildSitemap([o]).filter((e) => e.url.includes("real-scholarship"));
    expect(entries.map((e) => e.url).sort()).toEqual(["az", "en", "ru"].map((l) => `${SITE}/${l}/opportunities/real-scholarship`));
    expect(entries.every((e) => e.lastModified instanceof Date)).toBe(true);
  });

  it("does not list a language in which the page would fall back to another language, nor point hreflang at it", () => {
    const o = real("az-only", ["az"]);
    const entries = buildSitemap([o]).filter((e) => e.url.includes("az-only"));
    const languages = entries.flatMap((e) => Object.keys(e.alternates?.languages ?? {}));
    expect(entries.map((e) => e.url)).toEqual([`${SITE}/az/opportunities/az-only`]);
    expect(languages).toContain("az");
    expect(languages).not.toContain("ru");
    expect(languages).not.toContain("en");
  });
});
