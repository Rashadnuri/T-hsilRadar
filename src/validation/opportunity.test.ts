import { describe, expect, it } from "vitest";
import {
  httpsUrlSchema, opportunityInputSchema, opportunitySubmissionSchema, translationInputSchema, verifiedOutcomeSchema,
} from "./opportunity";

const base = {
  slug: "demo-scholarship", organizationId: "org-1", opportunityType: "scholarship", locationType: "onsite", country: "AZ", cityId: "baku",
  originalLanguage: "az", deadlineType: "fixed", applicationDeadline: "2027-01-31T19:59:59.999Z",
} as const;

const issues = (input: unknown, schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { message: string }[] } } } = opportunityInputSchema) => {
  const r = schema.safeParse(input);
  return r.success ? [] : r.error!.issues.map((i) => i.message);
};

describe("opportunityInputSchema", () => {
  it("accepts a minimal valid opportunity and applies safe defaults", () => {
    const r = opportunityInputSchema.parse(base);
    expect(r).toMatchObject({ fundingType: "not_specified", eligibleCountries: null, educationLevels: [], isDemo: false, deadlineTimezone: "Asia/Baku" });
  });

  describe("type", () => {
    it("accepts every required opportunity type including grant", () => {
      for (const t of ["scholarship", "internship", "grant", "admission", "exchange", "training", "certification", "summer_school", "hackathon", "competition", "research"]) {
        expect(issues({ ...base, opportunityType: t })).toEqual([]);
      }
    });
    it("'other' needs a label, other types must not have one", () => {
      expect(issues({ ...base, opportunityType: "other" })).toContain("other_type_label_required");
      expect(issues({ ...base, opportunityType: "other", otherTypeLabel: "Leadership" })).toEqual([]);
      expect(issues({ ...base, otherTypeLabel: "x" })).toContain("other_type_label_only_for_other");
    });
    it("rejects unknown types", () => expect(issues({ ...base, opportunityType: "course" }).length).toBeGreaterThan(0));
  });

  describe("location", () => {
    it("onsite and hybrid need a country; remote does not", () => {
      expect(issues({ ...base, country: null, cityId: null })).toContain("country_required_for_onsite_or_hybrid");
      expect(issues({ ...base, locationType: "hybrid", country: null, cityId: null })).toContain("country_required_for_onsite_or_hybrid");
      expect(issues({ ...base, locationType: "remote", country: null, cityId: null })).toEqual([]);
    });
    it("supports Baku, Sumgait and Ganja", () => {
      for (const cityId of ["baku", "sumgait", "ganja"]) expect(issues({ ...base, cityId })).toEqual([]);
    });
    it("a city must belong to the stated country", () => expect(issues({ ...base, country: "DE", cityId: "baku" })).toContain("city_country_mismatch"));
    it("supports international countries and cities", () => expect(issues({ ...base, country: "DE", cityId: "berlin" })).toEqual([]));
    it("free-text city allowed for unlisted cities, but not together with a reference city", () => {
      expect(issues({ ...base, cityId: null, cityText: "Leipzig", country: "DE" })).toEqual([]);
      expect(issues({ ...base, cityText: "Baku" })).toContain("city_id_and_text_both_set");
    });
    it("rejects an unknown city id", () => expect(issues({ ...base, cityId: "atlantis" })).toContain("unknown_city"));
    it("country must be an upper-case ISO code", () => expect(issues({ ...base, country: "az" })).toContain("invalid_country_code"));
  });

  describe("deadlines", () => {
    it("fixed needs a deadline; rolling/unknown must not have one", () => {
      expect(issues({ ...base, applicationDeadline: null })).toContain("deadline_required");
      expect(issues({ ...base, deadlineType: "rolling" })).toContain("deadline_only_for_fixed");
      expect(issues({ ...base, deadlineType: "rolling", applicationDeadline: null })).toEqual([]);
    });
    it("start must not be after the deadline", () => expect(issues({ ...base, applicationStartDate: "2027-02-01T00:00:00Z" })).toContain("start_after_deadline"));
    it("rejects malformed dates and time zones", () => {
      expect(issues({ ...base, applicationDeadline: "31/01/2027" })).toContain("invalid_datetime");
      expect(issues({ ...base, deadlineTimezone: "Mars/Olympus" })).toContain("invalid_timezone");
    });
  });

  describe("funding", () => {
    it("accepts all six funding types", () => {
      for (const f of ["fully_funded", "partially_funded", "paid", "unpaid", "tuition_discount", "not_specified"]) {
        expect(issues({ ...base, fundingType: f })).toEqual([]);
      }
    });
    it("an amount needs a currency (and vice versa)", () => {
      expect(issues({ ...base, fundingType: "paid", fundingAmount: 800 })).toContain("amount_and_currency_go_together");
      expect(issues({ ...base, fundingType: "paid", fundingCurrency: "AZN" })).toContain("amount_and_currency_go_together");
      expect(issues({ ...base, fundingType: "paid", fundingAmount: 800, fundingCurrency: "AZN", fundingPeriod: "monthly" })).toEqual([]);
    });
    it("unpaid / not_specified cannot carry an amount", () => {
      expect(issues({ ...base, fundingType: "unpaid", fundingAmount: 100, fundingCurrency: "AZN" })).toContain("amount_not_allowed_for_funding_type");
      expect(issues({ ...base, fundingType: "not_specified", fundingAmount: 100, fundingCurrency: "AZN" })).toContain("amount_not_allowed_for_funding_type");
    });
    it("percent only for tuition discounts, 1–100", () => {
      expect(issues({ ...base, fundingType: "tuition_discount", fundingPercent: 30 })).toEqual([]);
      expect(issues({ ...base, fundingType: "paid", fundingPercent: 30 })).toContain("percent_only_for_tuition_discount");
      expect(issues({ ...base, fundingType: "tuition_discount", fundingPercent: 101 })).toContain("percent_out_of_range");
    });
    it("rejects negative amounts and a period without an amount", () => {
      expect(issues({ ...base, fundingType: "paid", fundingAmount: -5, fundingCurrency: "AZN" })).toContain("amount_must_be_positive");
      expect(issues({ ...base, fundingPeriod: "monthly" })).toContain("period_requires_amount");
    });
    it("participation fee is independent of funding and needs a currency", () => {
      expect(issues({ ...base, fundingType: "unpaid", participationFeeAmount: 300, participationFeeCurrency: "USD" })).toEqual([]);
      expect(issues({ ...base, participationFeeAmount: 300 })).toContain("fee_and_currency_go_together");
    });
  });

  describe("eligibility", () => {
    it("null means 'not stated'; an empty list is rejected as ambiguous", () => {
      expect(issues({ ...base, eligibleCountries: null })).toEqual([]);
      expect(issues({ ...base, eligibleCountries: [] })).toContain("eligible_countries_empty_use_null");
    });
    it("rejects duplicates and invalid codes", () => {
      expect(issues({ ...base, eligibleCountries: ["AZ", "AZ"] })).toContain("duplicate_countries");
      expect(issues({ ...base, educationLevels: ["bachelor", "bachelor"] })).toContain("duplicate_values");
      expect(issues({ ...base, educationLevels: ["kindergarten"] }).length).toBeGreaterThan(0);
    });
  });
});

describe("URL validation (SECURITY.md §6)", () => {
  it.each(["https://example.com/program", "https://sub.university.edu/apply?id=1"])("accepts %s", (u) => expect(httpsUrlSchema.safeParse(u).success).toBe(true));
  it.each([
    "http://example.com", "javascript:alert(1)", "https://localhost/x", "https://127.0.0.1/x", "https://192.168.1.5/x", "https://10.0.0.1/x",
    "https://user:pass@example.com", "ftp://example.com", "not a url", "https://intranet/x", "https://service.internal/x",
  ])("rejects %s", (u) => expect(httpsUrlSchema.safeParse(u).success).toBe(false));
});

describe("translationInputSchema", () => {
  const original = { language: "az", status: "original", title: "Başlıq", shortDescription: "Qısa" } as const;
  it("accepts an original row", () => expect(translationInputSchema.safeParse(original).success).toBe(true));
  it("allows incomplete translations (only the title is mandatory)", () => {
    expect(translationInputSchema.safeParse({ language: "ru", status: "human", translatedFrom: "az", title: "Заголовок" }).success).toBe(true);
    expect(issues({ language: "ru", status: "human", translatedFrom: "az", title: "" }, translationInputSchema)).toContain("title_required");
  });
  it("rejects raw HTML anywhere (rendered as restricted Markdown only)", () => {
    for (const bad of ["<script>alert(1)</script>", "<img src=x onerror=1>", "text <b>bold</b>", "<!-- x -->"]) {
      expect(issues({ ...original, description: bad }, translationInputSchema)).toContain("html_not_allowed");
    }
    expect(translationInputSchema.safeParse({ ...original, description: "Compare 3 < 5 and 7 > 2." }).success).toBe(true);
  });
  it("a translation must name its source language; an original must not", () => {
    expect(issues({ language: "en", status: "human", title: "T" }, translationInputSchema)).toContain("translation_needs_source_language");
    expect(issues({ ...original, translatedFrom: "ru" }, translationInputSchema)).toContain("original_cannot_have_source");
  });
  it("enforces length limits", () => expect(issues({ ...original, title: "x".repeat(201) }, translationInputSchema)).toContain("text_too_long"));
});

describe("opportunitySubmissionSchema (multilingual invariants)", () => {
  const original = { language: "az", status: "original", title: "Başlıq", shortDescription: "Qısa" };
  const en = { language: "en", status: "human", translatedFrom: "az", title: "Title" };
  const submit = (translations: unknown[], opportunity: unknown = base) => issues({ opportunity, translations }, opportunitySubmissionSchema);

  it("accepts an original-only submission (one canonical record, translations optional)", () => expect(submit([original])).toEqual([]));
  it("accepts original + incomplete translation", () => expect(submit([original, en])).toEqual([]));
  it("requires at least one translation", () => expect(submit([])).toContain("translation_required"));
  it("requires exactly one original row", () => {
    expect(submit([en])).toContain("exactly_one_original_required");
    expect(submit([original, { ...original, language: "en" }])).toContain("exactly_one_original_required");
  });
  it("the original row must be in originalLanguage", () => expect(submit([{ ...original, language: "ru" }])).toContain("original_language_mismatch"));
  it("no duplicate languages", () => expect(submit([original, en, { ...en, title: "Other" }])).toContain("duplicate_language"));
  it("the original needs a short description", () => expect(submit([{ ...original, shortDescription: null }])).toContain("original_short_description_required"));
  it("supports a non-interface original language (de) with az/en translations", () => {
    const de = { language: "de", status: "original", title: "Titel", shortDescription: "Kurz" };
    expect(submit([de, { ...en, translatedFrom: "de" }], { ...base, originalLanguage: "de", country: "DE", cityId: "berlin" })).toEqual([]);
  });
  it("translations must come from the original language", () => expect(submit([original, { ...en, translatedFrom: "ru" }])).toContain("translate_from_original_language"));
});

describe("verification checklist", () => {
  const ok = { sourceIsOfficial: true, organizationIdentityConfirmed: true, deadlineMatchesSource: true, noFeeOrScamSigns: true, linksWork: true };
  it("only an all-true checklist can verify", () => {
    expect(verifiedOutcomeSchema.safeParse(ok).success).toBe(true);
    expect(issues({ ...ok, noFeeOrScamSigns: false }, verifiedOutcomeSchema)).toContain("checklist_incomplete");
  });
});
