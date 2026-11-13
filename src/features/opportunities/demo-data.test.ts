import { describe, expect, it } from "vitest";
import { getAvailableLanguages, resolveContent } from "@/lib/opportunities/translations";
import { isListable, isPublic } from "@/lib/opportunities/status";
import { isExpired } from "@/lib/opportunities/deadline";
import { opportunitySubmissionSchema } from "@/validation/opportunity";
import { getDemoRecords } from "./demo-data";

const records = getDemoRecords();
/** Fields the server sets (never part of a submission). */
const SERVER_FIELDS = ["organization", "translations", "id", "publicationStatus", "verificationStatus", "lastVerifiedAt", "verifiedBy", "contentVersion", "publishedAt", "createdBy", "createdAt", "updatedAt"];
const submissionOf = (r: (typeof records)[number]) => ({
  opportunity: Object.fromEntries(Object.entries(r).filter(([key]) => !SERVER_FIELDS.includes(key))),
  translations: r.translations,
});

describe("demo data integrity", () => {
  it("every record passes the same validation as real submissions", () => {
    for (const r of records) {
      const result = opportunitySubmissionSchema.safeParse(submissionOf(r));
      expect(result.success, `${r.slug}: ${JSON.stringify(result.error?.issues.map((i) => i.message))}`).toBe(true);
    }
  });
  it("is unmistakably demo: flagged, fictional organization, example.com links, never verified", () => {
    for (const r of records) {
      expect(r.isDemo).toBe(true);
      expect(r.organization.isDemo).toBe(true);
      expect(r.organization.name.startsWith("Demo ")).toBe(true);
      expect(r.verificationStatus).toBe("unverified");
      expect(r.verifiedBy).toBeNull();
      expect(r.officialSourceUrl).toContain("example.com");
      expect(r.applicationUrl).toContain("example.com");
    }
  });
  it("has unique ids and slugs, and every record has exactly one original translation", () => {
    expect(new Set(records.map((r) => r.id)).size).toBe(records.length);
    expect(new Set(records.map((r) => r.slug)).size).toBe(records.length);
    for (const r of records) expect(r.translations.filter((t) => t.status === "original")).toHaveLength(1);
  });
  it("covers every opportunity type and both location kinds", () => {
    const types = new Set(records.map((r) => r.opportunityType));
    for (const t of ["scholarship", "internship", "grant", "admission", "exchange", "training", "certification", "summer_school", "hackathon", "competition", "research", "other"]) {
      expect(types.has(t as never), t).toBe(true);
    }
    expect(new Set(records.map((r) => r.locationType))).toEqual(new Set(["onsite", "remote", "hybrid"]));
    expect(new Set(records.map((r) => r.cityId).filter(Boolean))).toEqual(expect.objectContaining(new Set(["baku", "sumgait", "ganja"])));
  });
  it("includes expiry cases: public by link, but never listed", () => {
    const expired = records.filter((r) => r.slug.startsWith("demo-expired-"));
    expect(expired.length).toBe(2);
    for (const r of expired) {
      expect(isExpired(r)).toBe(true);
      expect(isPublic(r)).toBe(true);
      expect(isListable(r)).toBe(false);
    }
    expect(records.filter((r) => isListable(r)).length).toBe(records.length - expired.length);
  });
  it("covers Azerbaijani cities beyond Baku, Sumgait and Ganja, and local scholarships and internships", () => {
    const azCities = new Set(records.filter((r) => r.country === "AZ").map((r) => r.cityId));
    for (const c of ["baku", "sumgait", "ganja", "mingachevir", "shaki", "nakhchivan"]) expect(azCities.has(c), c).toBe(true);
    const local = records.filter((r) => r.country === "AZ");
    expect(local.some((r) => r.opportunityType === "scholarship")).toBe(true);
    expect(local.some((r) => r.opportunityType === "internship")).toBe(true);
  });
  it("has varied last-updated dates so 'recently updated' differs from 'newest'", () => {
    expect(new Set(records.map((r) => r.updatedAt.slice(0, 10))).size).toBeGreaterThan(3);
    for (const r of records) expect(Date.parse(r.updatedAt)).toBeGreaterThanOrEqual(Date.parse(r.publishedAt!) - 1000);
  });
  it("exercises the multilingual rules", () => {
    const bySlug = (s: string) => records.find((r) => r.slug === s)!;
    // German original preserved; Russian visitor sees German, labelled
    const exchange = bySlug("demo-exchange-semester");
    expect(exchange.originalLanguage).toBe("de");
    expect(resolveContent(exchange, "ru").title).toMatchObject({ language: "de", isFallback: true });
    expect(resolveContent(exchange, "en").title).toMatchObject({ language: "en", isFallback: false });
    // Incomplete translation: Azerbaijani has a description but falls back to German for requirements
    expect(resolveContent(exchange, "az").requirements).toMatchObject({ language: "de", isFallback: true });
    // Machine draft is invisible
    const internship = bySlug("demo-it-internship");
    expect(resolveContent(internship, "ru").title.language).toBe("az");
    expect(getAvailableLanguages(internship)).toEqual(["az", "en"]);
    // Machine-approved is shown with its flag
    expect(resolveContent(bySlug("demo-research-fellowship"), "az").hasMachineTranslation).toBe(true);
    // Turkish original, no az/ru
    expect(resolveContent(bySlug("demo-university-admission-tr"), "az").title).toMatchObject({ language: "tr", isFallback: true });
  });
});
