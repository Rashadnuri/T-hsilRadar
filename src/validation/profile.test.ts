import { describe, expect, it } from "vitest";
import { normalizeTags, parseProfileForm } from "./profile";

const NOW = new Date("2026-06-15T00:00:00Z");
const form = (entries: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};
const base: [string, string][] = [["fullName", "Aysel Məmmədova"]];
const parse = (extra: [string, string][] = [], replaceName?: string) => parseProfileForm(form(replaceName === undefined ? [...base, ...extra] : [["fullName", replaceName], ...extra]), NOW);
const err = (r: ReturnType<typeof parse>) => (r.ok ? {} : r.errors);

describe("parseProfileForm", () => {
  it("accepts a name-only profile (everything else is optional) with empty defaults", () => {
    expect(parse()).toEqual({ ok: true, value: {
      fullName: "Aysel Məmmədova", educationLevel: null, university: null, academicField: null, graduationYear: null, countryOfResidence: null,
      preferredCountries: [], skills: [], languages: [], careerInterests: [], preferredOpportunityTypes: [],
    } });
  });

  it("parses a complete profile", () => {
    const r = parse([
      ["educationLevel", "master"], ["university", "  Demo University "], ["academicField", "ict"], ["graduationYear", "2027"], ["countryOfResidence", "AZ"],
      ["preferredCountries", "DE"], ["preferredCountries", "TR"], ["skills", "Python"], ["skills", "  public   speaking "], ["careerInterests", "Data science"],
      ["languageCode", "az"], ["languageLevel", "native"], ["languageCode", "en"], ["languageLevel", "B2"],
      ["preferredTypes", "scholarship"], ["preferredTypes", "internship"],
    ]);
    expect(r).toEqual({ ok: true, value: {
      fullName: "Aysel Məmmədova", educationLevel: "master", university: "Demo University", academicField: "ict", graduationYear: 2027, countryOfResidence: "AZ",
      preferredCountries: ["DE", "TR"], skills: ["Python", "public speaking"], languages: [{ code: "az", level: "native" }, { code: "en", level: "B2" }],
      careerInterests: ["Data science"], preferredOpportunityTypes: ["scholarship", "internship"],
    } });
  });

  it("treats blank optional fields as not provided", () => {
    const r = parse([["educationLevel", ""], ["university", "  "], ["academicField", ""], ["graduationYear", ""], ["countryOfResidence", ""]]);
    expect(r.ok).toBe(true);
  });

  describe("errors are codes with parameters", () => {
    it("full name is required, bounded and HTML-free", () => {
      expect(err(parse([], ""))).toMatchObject({ fullName: { code: "required" } });
      expect(err(parse([], "A"))).toMatchObject({ fullName: { code: "name_too_short", params: { min: 2 } } });
      expect(err(parse([], "x".repeat(121)))).toMatchObject({ fullName: { code: "text_too_long", params: { max: 120 } } });
      expect(err(parse([], "<script>x</script>"))).toMatchObject({ fullName: { code: "html_not_allowed" } });
    });
    it("university: length and HTML", () => {
      expect(err(parse([["university", "x".repeat(201)]]))).toMatchObject({ university: { code: "text_too_long", params: { max: 200 } } });
      expect(err(parse([["university", "Uni <b>x</b>"]]))).toMatchObject({ university: { code: "html_not_allowed" } });
    });
    it("choices must come from the closed lists", () => {
      expect(err(parse([["educationLevel", "wizard"]]))).toMatchObject({ educationLevel: { code: "invalid_choice" } });
      expect(err(parse([["academicField", "astrology"]]))).toMatchObject({ academicField: { code: "invalid_choice" } });
      expect(err(parse([["preferredTypes", "lottery"]]))).toMatchObject({ preferredOpportunityTypes: { code: "invalid_choice" } });
    });
    it("graduation year: a window around the current year, with the bounds as parameters", () => {
      expect(parse([["graduationYear", "2026"]]).ok).toBe(true);
      expect(parse([["graduationYear", "2036"]]).ok).toBe(true);
      expect(parse([["graduationYear", "1966"]]).ok).toBe(true);
      for (const bad of ["2037", "1965", "abc", "2026.5", "-1"]) {
        expect(err(parse([["graduationYear", bad]])), bad).toMatchObject({ graduationYear: { code: "invalid_year", params: { min: 1966, max: 2036 } } });
      }
    });
    it("countries must be real ISO codes; duplicates are merged; at most 20", () => {
      expect(err(parse([["countryOfResidence", "XX"]]))).toMatchObject({ countryOfResidence: { code: "invalid_country" } });
      expect(err(parse([["countryOfResidence", "az"]]))).toMatchObject({ countryOfResidence: { code: "invalid_country" } });
      expect(err(parse([["preferredCountries", "Germany"]]))).toMatchObject({ preferredCountries: { code: "invalid_country" } });
      const merged = parse([["preferredCountries", "DE"], ["preferredCountries", "DE"], ["preferredCountries", ""]]);
      expect(merged.ok && merged.value.preferredCountries).toEqual(["DE"]);
      const many = ["AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AR", "AT", "AU", "AW", "AZ", "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI"].map((c): [string, string] => ["preferredCountries", c]);
      expect(err(parse(many))).toMatchObject({ preferredCountries: { code: "too_many_items", params: { max: 20 } } });
    });
    it("skills and interests: normalised, de-duplicated, bounded, HTML-free", () => {
      expect(err(parse([["skills", "x".repeat(51)]]))).toMatchObject({ skills: { code: "item_too_long", params: { max: 50 } } });
      expect(err(parse([["careerInterests", "x".repeat(61)]]))).toMatchObject({ careerInterests: { code: "item_too_long", params: { max: 60 } } });
      expect(err(parse([["skills", "<img src=x onerror=1>"]]))).toMatchObject({ skills: { code: "html_not_allowed" } });
      expect(err(parse(Array.from({ length: 31 }, (_, i): [string, string] => ["skills", `skill ${i}`])))).toMatchObject({ skills: { code: "too_many_items", params: { max: 30 } } });
      expect(err(parse(Array.from({ length: 21 }, (_, i): [string, string] => ["careerInterests", `interest ${i}`])))).toMatchObject({ careerInterests: { code: "too_many_items", params: { max: 20 } } });
      const dup = parse([["skills", "Python"], ["skills", "python"], ["skills", " PYTHON "]]);
      expect(dup.ok && dup.value.skills).toEqual(["Python"]);
    });
    it("languages: known code + level, no duplicates, blank rows ignored", () => {
      expect(err(parse([["languageCode", "xx"], ["languageLevel", "B2"]]))).toMatchObject({ languages: { code: "invalid_language" } });
      expect(err(parse([["languageCode", "en"], ["languageLevel", "expert"]]))).toMatchObject({ languages: { code: "invalid_language" } });
      expect(err(parse([["languageCode", "en"], ["languageLevel", ""]]))).toMatchObject({ languages: { code: "invalid_language" } });
      expect(err(parse([["languageCode", "en"], ["languageLevel", "B2"], ["languageCode", "en"], ["languageLevel", "C1"]]))).toMatchObject({ languages: { code: "duplicate_items" } });
      expect(parse([["languageCode", ""], ["languageLevel", ""]]).ok).toBe(true);
    });
    it("preferred types are de-duplicated", () => {
      const r = parse([["preferredTypes", "grant"], ["preferredTypes", "grant"]]);
      expect(r.ok && r.value.preferredOpportunityTypes).toEqual(["grant"]);
    });
  });
});

describe("normalizeTags", () => {
  it("trims, collapses whitespace, drops empties, de-duplicates ignoring case, keeps the first spelling", () => {
    expect(normalizeTags(["  Data   science ", "data SCIENCE", "", "  ", "Python"])).toEqual(["Data science", "Python"]);
  });
});
