import { describe, expect, it } from "vitest";
import { getAzerbaijaniCities, getCityName } from "../cities";
import { allowsFundingAmount, formatAmount, fundingPeriodKey, providesFunding } from "../funding";
import { checkCountryEligibility, deriveMarketScope, getLocationIssues, isInAzerbaijan } from "../location";
import { isSafeHttpsUrl, isOnOrganizationDomain } from "../source";
import { isValidSlug, slugify, uniqueSlug } from "../slug";

describe("location", () => {
  it("Azerbaijani cities include Baku, Sumgait and Ganja with all three names", () => {
    const ids = getAzerbaijaniCities().map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["baku", "sumgait", "ganja"]));
    expect(getCityName("baku", null, "az")).toBe("Bakı");
    expect(getCityName("baku", null, "ru")).toBe("Баку");
    expect(getCityName("sumgait", null, "en")).toBe("Sumgait");
    expect(getCityName("ganja", null, "az")).toBe("Gəncə");
  });
  it("falls back to the published free text for unlisted cities", () => expect(getCityName(null, "Leipzig", "ru")).toBe("Leipzig"));
  it("derives the market scope", () => {
    expect(deriveMarketScope({ country: "AZ", eligibleCountries: null })).toBe("azerbaijan");
    expect(deriveMarketScope({ country: "DE", eligibleCountries: ["AZ"] })).toBe("international");
    expect(deriveMarketScope({ country: null, eligibleCountries: null })).toBe("both");
    expect(deriveMarketScope({ country: null, eligibleCountries: ["AZ"] })).toBe("azerbaijan");
    expect(deriveMarketScope({ country: null, eligibleCountries: ["AZ", "GE"] })).toBe("both");
    expect(deriveMarketScope({ country: null, eligibleCountries: ["GE"] })).toBe("international");
    expect(isInAzerbaijan({ country: "AZ" })).toBe(true);
  });
  it("eligibility distinguishes 'not stated' from 'eligible'", () => {
    expect(checkCountryEligibility({ eligibleCountries: null }, "AZ")).toBe("unspecified");
    expect(checkCountryEligibility({ eligibleCountries: ["AZ"] }, "AZ")).toBe("eligible");
    expect(checkCountryEligibility({ eligibleCountries: ["DE"] }, "AZ")).toBe("not_eligible");
  });
  it("reports location inconsistencies", () => {
    expect(getLocationIssues({ locationType: "remote", country: null, cityId: "baku", cityText: null })).toContain("city_requires_country");
  });
});

describe("funding", () => {
  it("knows which types carry amounts", () => {
    expect(allowsFundingAmount("paid")).toBe(true);
    expect(allowsFundingAmount("unpaid")).toBe(false);
    expect(providesFunding("tuition_discount")).toBe(true);
    expect(providesFunding("not_specified")).toBe(false);
  });
  it("formats money in the source currency, per locale", () => {
    expect(formatAmount(800, "AZN", "en")).toContain("800");
    expect(formatAmount(1500, "EUR", "en")).toContain("€");
  });
  it("period keys", () => {
    expect(fundingPeriodKey("monthly")).toBe("monthly");
    expect(fundingPeriodKey("total")).toBeNull();
  });
});

describe("slug", () => {
  it("transliterates Azerbaijani and Cyrillic", () => {
    expect(slugify("Təqaüd proqramı: Gəncə şəhəri")).toBe("teqaud-proqrami-gence-seheri");
    expect(slugify("Стипендия для магистров")).toBe("stipendiya-dlya-magistrov");
    expect(slugify("  --İstanbul   Demo!! ")).toBe("istanbul-demo");
  });
  it("validates slugs and generates unique ones", () => {
    expect(isValidSlug("demo-1")).toBe(true);
    expect(isValidSlug("Demo")).toBe(false);
    expect(isValidSlug("a--b")).toBe(false);
    expect(uniqueSlug("Demo Grant", new Set(["demo-grant", "demo-grant-2"]))).toBe("demo-grant-3");
    expect(uniqueSlug("???", new Set())).toBe("opportunity");
  });
});

describe("source URLs", () => {
  it("safe https only", () => {
    expect(isSafeHttpsUrl("https://example.com/a")).toBe(true);
    expect(isSafeHttpsUrl("http://example.com/a")).toBe(false);
    expect(isSafeHttpsUrl("https://localhost:3000")).toBe(false);
  });
  it("detects sources outside the organization's own domain", () => {
    expect(isOnOrganizationDomain("https://apply.university.edu/x", "https://www.university.edu")).toBe(true);
    expect(isOnOrganizationDomain("https://evil-university.edu/x", "https://university.edu")).toBe(false);
    expect(isOnOrganizationDomain("https://aggregator.com/uni", "https://university.edu")).toBe(false);
  });
});
