import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDemoRecords } from "@/features/opportunities/demo-data";
import type { OpportunityRecord } from "@/types/opportunity";
import { buildOpportunityMetadata, DESCRIPTION_MAX, truncateDescription } from "./opportunity-metadata";

const SITE = "https://tahsilradar.test";
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("VERCEL_URL", "");
});
afterEach(() => vi.unstubAllEnvs());

const base = getDemoRecords().find((o) => o.translations.length >= 3)!;
type L = "az" | "ru" | "en";
/** A real (non-demo) record whose translations are exactly `languages` (first = original). */
const real = (languages: L[], patch: Partial<OpportunityRecord["translations"][number]> = {}): OpportunityRecord => ({
  ...base,
  slug: "real-scholarship",
  isDemo: false,
  originalLanguage: languages[0]!,
  translations: languages.map((language, i) => ({ ...base.translations[0]!, language, status: i === 0 ? "original" : "human", title: `Title ${language}`, shortDescription: `Short ${language}`, ...patch })),
});
const langs = (m: ReturnType<typeof buildOpportunityMetadata>) => Object.keys((m.alternates?.languages ?? {}) as object).sort();
const canonical = (m: ReturnType<typeof buildOpportunityMetadata>) => m.alternates?.canonical;

describe("buildOpportunityMetadata", () => {
  it("a fully translated real record: localized title/description, self canonical, hreflang for all 3 + x-default, indexable", () => {
    const o = real(["az", "ru", "en"]);
    for (const l of ["az", "ru", "en"] as const) {
      const m = buildOpportunityMetadata(o, l);
      expect(m.title).toBe(`Title ${l}`);
      expect(m.description).toBe(`Short ${l}`);
      expect(canonical(m)).toBe(`${SITE}/${l}/opportunities/real-scholarship`);
      expect(langs(m)).toEqual(["az", "en", "ru", "x-default"]);
      expect(m.robots).toBeUndefined(); // indexable
      expect((m.openGraph as { locale?: string }).locale).toBe({ az: "az_AZ", ru: "ru_RU", en: "en_US" }[l]);
    }
  });

  it("a record with only az+en: the ru page is noindex with NO hreflang; az/en list only each other", () => {
    const o = real(["az", "en"]);
    const ru = buildOpportunityMetadata(o, "ru");
    expect(ru.robots).toEqual({ index: false, follow: true });
    expect(ru.alternates?.languages).toBeUndefined();
    expect(canonical(ru)).toContain("/ru/opportunities/real-scholarship"); // self, not pointing to another language
    for (const l of ["az", "en"] as const) {
      const m = buildOpportunityMetadata(o, l);
      expect(m.robots).toBeUndefined();
      expect(langs(m)).toEqual(["az", "en", "x-default"]);
    }
  });

  it("x-default is az when az is available, otherwise the first available language", () => {
    const azLang = buildOpportunityMetadata(real(["az", "en"]), "en").alternates?.languages as Record<string, string>;
    expect(azLang["x-default"]).toMatch(/\/az\/opportunities\//);
    // az missing: the record's ORIGINAL language wins over list order (en is the original, ru is a translation)
    const noAz = buildOpportunityMetadata(real(["en", "ru"]), "ru").alternates?.languages as Record<string, string>;
    expect(noAz["x-default"]).toMatch(/\/en\/opportunities\//);
    const ruOriginal = buildOpportunityMetadata(real(["ru", "en"]), "en").alternates?.languages as Record<string, string>;
    expect(ruOriginal["x-default"]).toMatch(/\/ru\/opportunities\//);
  });

  it("demo records are always noindex, whatever their translations", () => {
    const m = buildOpportunityMetadata({ ...real(["az", "ru", "en"]), isDemo: true }, "en");
    expect(m.robots).toEqual({ index: false, follow: true });
    expect(m.alternates?.languages).toBeUndefined();
  });

  it("without a short description the description comes from the full text, not from the title", () => {
    const o = real(["en"], { shortDescription: null, description: "A long description of the programme. ".repeat(10) });
    const m = buildOpportunityMetadata(o, "en");
    expect(m.description).toMatch(/^A long description of the programme\./);
    expect((m.description as string).length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(m.description).not.toBe("Title en");
  });

  it("falls back to the title only when there is no other text", () => {
    expect(buildOpportunityMetadata(real(["en"], { shortDescription: null, description: null }), "en").description).toBe("Title en");
  });

  it("carries Open Graph image and Twitter card", () => {
    const m = buildOpportunityMetadata(real(["en"]), "en");
    expect((m.openGraph as { images?: { url: string }[] }).images?.[0]?.url).toBe("/og.png");
    expect((m.twitter as { card?: string }).card).toBe("summary_large_image");
  });
});

describe("truncateDescription", () => {
  it("leaves short text alone and collapses whitespace", () => {
    expect(truncateDescription("  one \n two  ")).toBe("one two");
  });
  it("cuts long text at a word boundary within the limit and adds an ellipsis", () => {
    const out = truncateDescription("word ".repeat(100));
    expect(out.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\bwor…$/);
  });
  it("handles one very long word", () => {
    expect(truncateDescription("x".repeat(500)).length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });
});
