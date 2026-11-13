import { describe, expect, it } from "vitest";
import { utcToZonedLocal, zonedLocalToUtc } from "@/lib/opportunities/deadline";
import { parseOpportunityForm, parseOrganizationForm } from "./admin";

const ORG = "11111111-1111-4111-8111-111111111111";

function form(values: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) for (const item of Array.isArray(v) ? v : [v]) f.append(k, item);
  return f;
}
const valid = (extra: Record<string, string | string[]> = {}) => ({
  organizationId: ORG, opportunityType: "scholarship", locationType: "onsite", country: "DE", originalLanguage: "az", deadlineType: "fixed", deadline: "2027-03-01T18:00",
  officialSourceUrl: "https://org.example.com/program", t_az_title: "Orijinal başlıq", t_az_short: "Qısa təsvir", ...extra,
});
const codes = (r: ReturnType<typeof parseOpportunityForm>) => (r.ok ? {} : Object.fromEntries(Object.entries(r.errors).map(([k, v]) => [k, v.code])));

describe("opportunity form", () => {
  it("parses a valid form, converting the deadline from the organization's time zone to UTC", () => {
    const r = parseOpportunityForm(form(valid()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ slug: "orijinal-basliq", organizationId: ORG, opportunityType: "scholarship", country: "DE", deadlineType: "fixed", deadlineTimezone: "Asia/Baku", originalLanguage: "az", featured: false });
    expect(r.value.applicationDeadline).toBe("2027-03-01T14:00:00.000Z"); // 18:00 in Baku (UTC+4)
    expect(r.value.translations).toEqual([expect.objectContaining({ language: "az", title: "Orijinal başlıq", status: "original", shortDescription: "Qısa təsvir", description: null })]);
  });
  it("accepts partial translations (a title is enough) and marks their status", () => {
    const r = parseOpportunityForm(form(valid({ t_en_title: "English title", t_ru_title: "Заголовок", t_ru_status: "machine_draft", t_ru_description: "Описание" })));
    expect(r.ok && r.value.translations.map((t) => `${t.language}:${t.status}`)).toEqual(["az:original", "ru:machine_draft", "en:human"]);
    expect(r.ok && r.value.translations.find((t) => t.language === "en")).toMatchObject({ shortDescription: null, description: null });
  });
  it("does not let a form approve a machine translation or fake an original", () => {
    expect(codes(parseOpportunityForm(form(valid({ t_ru_title: "x", t_ru_status: "machine_approved" }))))).toMatchObject({ t_ru_status: "invalid_choice" });
    expect(codes(parseOpportunityForm(form(valid({ t_ru_title: "x", t_ru_status: "original" }))))).toMatchObject({ t_ru_status: "invalid_choice" });
  });
  it("a translation with text but no title is an error; an empty section is simply absent", () => {
    expect(codes(parseOpportunityForm(form(valid({ t_en_description: "text only" }))))).toMatchObject({ t_en_title: "required" });
    const r = parseOpportunityForm(form(valid()));
    expect(r.ok && r.value.translations).toHaveLength(1);
  });
  it("an emptied section of an EXISTING translation becomes a removal; the original can never be emptied", () => {
    const r = parseOpportunityForm(form(valid()), { existingLanguages: ["en", "ru"] });
    expect(r.ok && r.value.removeLanguages).toEqual(["ru", "en"]);
    expect(codes(parseOpportunityForm(form(valid({ t_az_title: "" }))))).toMatchObject({ t_az_title: "required" });
  });
  it("an original in another language gets its own section (preserved in its own language)", () => {
    const r = parseOpportunityForm(form({ ...valid({ originalLanguage: "de" }), t_az_title: "", t_az_short: "", t_de_title: "Deutscher Titel", t_de_short: "Kurz" }));
    expect(r.ok && r.value.translations).toEqual([expect.objectContaining({ language: "de", status: "original", title: "Deutscher Titel" })]);
    // editing keeps the stored original language, whatever the form says
    const edit = parseOpportunityForm(form({ ...valid({ originalLanguage: "ru" }), t_az_title: "", t_ru_title: "x" }), { existingOriginalLanguage: "az", existingLanguages: [] });
    expect(edit.ok).toBe(false);
  });
  it.each([
    ["no organization", { organizationId: "" }, { organizationId: "required" }],
    ["unknown type", { opportunityType: "teleport" }, { opportunityType: "invalid_choice" }],
    ["'other' without a label", { opportunityType: "other" }, { otherTypeLabel: "other_label_required" }],
    ["label without 'other'", { otherTypeLabel: "Something" }, { otherTypeLabel: "other_label_not_allowed" }],
    ["onsite without country", { country: "" }, { country: "required" }],
    ["bad country", { country: "ZZ9" }, { country: "invalid_country" }],
    ["http source", { officialSourceUrl: "http://org.example.com" }, { officialSourceUrl: "invalid_url" }],
    ["javascript url", { applicationUrl: "javascript:alert(1)" }, { applicationUrl: "invalid_url" }],
    ["url with credentials", { officialSourceUrl: "https://user:pw@org.example.com/x" }, { officialSourceUrl: "invalid_url" }],
    ["fixed without date", { deadline: "" }, { deadline: "deadline_required" }],
    ["date with rolling", { deadlineType: "rolling" }, { deadline: "deadline_not_allowed" }],
    ["impossible date", { deadline: "2027-02-31T10:00" }, { deadline: "invalid_date" }],
    ["start after deadline", { startDate: "2028-01-01T10:00" }, { startDate: "dates_out_of_order" }],
    ["bad zone", { deadlineTimezone: "Mars/Base" }, { deadlineTimezone: "invalid_timezone" }],
    ["funding amount without currency", { fundingType: "paid", fundingAmount: "500" }, { fundingCurrency: "funding_pair" }],
    ["amount on unpaid", { fundingType: "unpaid", fundingAmount: "500", fundingCurrency: "EUR" }, { fundingAmount: "funding_not_allowed" }],
    ["percent without discount", { fundingType: "paid", fundingPercent: "50" }, { fundingPercent: "percent_not_allowed" }],
    ["negative amount", { fundingType: "paid", fundingAmount: "-5", fundingCurrency: "EUR" }, { fundingAmount: "invalid_amount" }],
    ["bad currency", { fundingType: "paid", fundingAmount: "5", fundingCurrency: "euro" }, { fundingCurrency: "invalid_currency" }],
    ["city and free text", { cityId: "berlin", cityText: "Munich" }, { cityText: "city_conflict" }],
    ["city of another country", { cityId: "baku" }, { cityId: "city_conflict" }],
    ["html in title", { t_az_title: "<b>x</b>" }, { t_az_title: "html_not_allowed" }],
    ["too long title", { t_az_title: "x".repeat(201) }, { t_az_title: "text_too_long" }],
    ["bad slug", { slug: "Not A Slug!" }, { slug: "invalid_slug" }],
    ["bad eligible countries", { eligibleCountries: "AZ, XX1" }, { eligibleCountries: "invalid_country" }],
    ["bad education level", { educationLevels: ["bachelor", "wizard"] }, { educationLevels: "invalid_choice" }],
  ])("rejects %s", (_name, extra, expected) => {
    expect(codes(parseOpportunityForm(form(valid(extra as Record<string, string | string[]>))))).toMatchObject(expected);
  });
  it("remote opportunities need no country; funding, fees and eligibility parse", () => {
    const r = parseOpportunityForm(form(valid({ locationType: "remote", country: "", fundingType: "tuition_discount", fundingPercent: "50", feeAmount: "25,5", feeCurrency: "eur", eligibleCountries: "az; tr, AZ", educationLevels: ["master"], eligibleFields: ["ict"], deadlineType: "rolling", deadline: "", featured: "on" })));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ country: null, fundingPercent: 50, participationFeeAmount: 25.5, participationFeeCurrency: "EUR", eligibleCountries: ["AZ", "TR"], educationLevels: ["master"], eligibleFields: ["ict"], applicationDeadline: null, featured: true });
  });
  it("ignores fields a browser might add: status, verification and demo flags are not part of the form", () => {
    const r = parseOpportunityForm(form(valid({ publicationStatus: "published", publication_status: "published", verificationStatus: "verified", isDemo: "true", verifiedBy: "x", createdBy: "x" })));
    expect(r.ok && Object.keys(r.value)).not.toEqual(expect.arrayContaining(["publicationStatus", "verificationStatus", "isDemo", "verifiedBy", "createdBy"]));
    expect(JSON.stringify(r.ok && r.value)).not.toMatch(/published|verified/);
  });
  it("reports parameters for length errors so the message can show the limit", () => {
    const r = parseOpportunityForm(form(valid({ t_az_title: "x".repeat(201) })));
    expect(!r.ok && r.errors.t_az_title).toEqual({ code: "text_too_long", params: { max: 200 } });
  });
});

describe("organization form", () => {
  const org = (extra: Record<string, string> = {}) => form({ name: "Example University", kind: "university", country: "az", websiteUrl: "https://example.edu", ...extra });
  it("parses and derives the slug", () => {
    const r = parseOrganizationForm(org());
    expect(r).toEqual({ ok: true, value: { slug: "example-university", kind: "university", name: "Example University", country: "AZ", websiteUrl: "https://example.edu" } });
  });
  it.each([
    [{ name: "" }, "name", "required"], [{ kind: "club" }, "kind", "invalid_choice"], [{ websiteUrl: "http://example.edu" }, "websiteUrl", "invalid_url"],
    [{ country: "QQ" }, "country", "invalid_country"], [{ slug: "Bad Slug" }, "slug", "invalid_slug"], [{ name: "<i>x</i>" }, "name", "html_not_allowed"],
  ])("rejects %j", (extra, field, code) => {
    const r = parseOrganizationForm(org(extra));
    expect(!r.ok && r.errors[field]?.code).toBe(code);
  });
});

describe("zoned date-times", () => {
  it("converts a local time in the organization's zone to UTC and back (incl. daylight saving)", () => {
    expect(zonedLocalToUtc("2027-03-01T18:00", "Asia/Baku")).toBe("2027-03-01T14:00:00.000Z");
    expect(zonedLocalToUtc("2027-07-01T12:00", "Europe/Berlin")).toBe("2027-07-01T10:00:00.000Z"); // CEST
    expect(zonedLocalToUtc("2027-01-01T12:00", "Europe/Berlin")).toBe("2027-01-01T11:00:00.000Z"); // CET
    expect(utcToZonedLocal("2027-03-01T14:00:00.000Z", "Asia/Baku")).toBe("2027-03-01T18:00");
    for (const [local, zone] of [["2027-03-28T01:30", "Europe/Berlin"], ["2027-11-05T23:59", "America/New_York"], ["2027-06-15T00:00", "Asia/Baku"]] as const) {
      expect(utcToZonedLocal(zonedLocalToUtc(local, zone)!, zone)).toBe(local);
    }
  });
  it("rejects invalid input", () => {
    for (const bad of ["", "2027-13-01T10:00", "2027-02-30T10:00", "2027-01-01T25:00", "tomorrow", "2027-01-01"]) expect(zonedLocalToUtc(bad, "Asia/Baku")).toBeNull();
    expect(zonedLocalToUtc("2027-01-01T10:00", "Nope/Zone")).toBeNull();
  });
});
