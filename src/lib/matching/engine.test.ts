import { describe, expect, it } from "vitest";
import { getDemoRecords } from "@/features/opportunities/demo-data";
import { foldText } from "@/utils/fold-text";
import type { OpportunityRecord } from "@/types/opportunity";
import { emptyMatchProfile, matchOpportunity, rankMatches, termMatches, toMatchProfile, WEIGHTS } from "./engine";
import { SCORE_CAP_WHEN_INELIGIBLE, type MatchProfile } from "./types";

const NOW = new Date("2026-06-15T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

/** A controlled record: demo scaffolding with every matching-relevant field set explicitly. */
function record(overrides: Partial<OpportunityRecord> = {}, text: { title?: string; description?: string; requirements?: string | null } = {}): OpportunityRecord {
  const base = getDemoRecords()[0]!;
  const original = base.translations[0]!;
  return {
    ...base,
    id: "test-1",
    slug: "test-1",
    opportunityType: "scholarship",
    locationType: "onsite",
    country: "DE",
    educationLevels: ["master"],
    eligibleFields: ["ict", "engineering"],
    eligibleCountries: ["AZ", "TR"],
    applicationStartDate: null,
    applicationDeadline: day(40),
    deadlineType: "fixed",
    verificationStatus: "verified",
    isDemo: false,
    originalLanguage: "en",
    translations: [
      {
        ...original,
        language: "en",
        status: "original",
        title: text.title ?? "Master's scholarship in software engineering",
        shortDescription: "Funding for graduate study.",
        description: text.description ?? "A fully funded programme covering machine learning, Python programming and data science research for international students.",
        requirements: text.requirements === undefined ? null : text.requirements,
        benefits: null,
        eligibility: null,
      },
    ],
    ...overrides,
  };
}

const profile = (overrides: Partial<MatchProfile> = {}): MatchProfile => ({ ...emptyMatchProfile(), ...overrides });

const strongProfile = profile({
  educationLevel: "master",
  academicField: "ict",
  graduationYear: 2027,
  countryOfResidence: "AZ",
  preferredCountries: ["DE"],
  skills: ["Python", "Machine learning"],
  languages: [{ code: "en", level: "C1" }, { code: "az", level: "native" }],
  careerInterests: ["Data science"],
  preferredOpportunityTypes: ["scholarship"],
});

const statusOf = (m: ReturnType<typeof matchOpportunity>, id: string) => m.criteria.find((c) => c.id === id)?.status;

describe("a fully matching profile", () => {
  const m = matchOpportunity(strongProfile, record(), NOW);
  it("scores 100, is eligible and strong", () => {
    expect(m.score).toBe(100);
    expect(m.eligibility).toBe("eligible");
    expect(m.band).toBe("strong");
    expect(m.completeness).toBe(100);
  });
  it("explains the match with one reason per applicable criterion and no gaps", () => {
    expect(m.reasons.map((c) => c.id).sort()).toEqual(["country", "education", "field", "interests", "language", "location", "open", "type"].sort());
    expect(m.missing).toEqual([]);
    expect(m.unknown).toEqual([]);
  });
  it("lists mandatory reasons before preferences", () => {
    const flags = m.reasons.map((c) => c.mandatory);
    expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
  });
});

describe("mandatory eligibility", () => {
  it("education level not accepted → not eligible, score capped, named as missing", () => {
    const m = matchOpportunity(profile({ ...strongProfile, educationLevel: "bachelor" }), record(), NOW);
    expect(m.eligibility).toBe("not_eligible");
    expect(m.band).toBe("ineligible");
    expect(m.score).toBeLessThanOrEqual(SCORE_CAP_WHEN_INELIGIBLE);
    expect(m.missing[0]).toMatchObject({ id: "education", status: "unmet", mandatory: true, detail: { accepted: ["master"], yours: "bachelor" } });
  });
  it("field not accepted → not eligible", () => {
    const m = matchOpportunity(profile({ ...strongProfile, academicField: "arts_humanities" }), record(), NOW);
    expect(m.eligibility).toBe("not_eligible");
    expect(m.missing.map((c) => c.id)).toContain("field");
  });
  it("country not among the eligible ones → not eligible (residence-based, stated in the detail)", () => {
    const m = matchOpportunity(profile({ ...strongProfile, countryOfResidence: "US" }), record(), NOW);
    expect(m.eligibility).toBe("not_eligible");
    expect(m.missing[0]).toMatchObject({ id: "country", detail: { accepted: ["AZ", "TR"], yours: "US" } });
  });
  it("several unmet requirements are all reported", () => {
    const m = matchOpportunity(profile({ ...strongProfile, educationLevel: "phd", academicField: "health", countryOfResidence: "US" }), record(), NOW);
    expect(m.missing.map((c) => c.id).slice(0, 3).sort()).toEqual(["country", "education", "field"]);
  });
  it("criteria the opportunity does not define are not applied at all", () => {
    const m = matchOpportunity(strongProfile, record({ educationLevels: [], eligibleFields: [], eligibleCountries: null }), NOW);
    expect(m.criteria.map((c) => c.id)).not.toContain("education");
    expect(m.criteria.map((c) => c.id)).not.toContain("field");
    expect(m.criteria.map((c) => c.id)).not.toContain("country");
    expect(m.eligibility).toBe("eligible");
  });
  it('"general" field means every field is welcome', () => {
    const m = matchOpportunity(profile({ ...strongProfile, academicField: "health" }), record({ eligibleFields: ["general"] }), NOW);
    expect(m.criteria.map((c) => c.id)).not.toContain("field");
  });
  it("an expired opportunity is closed and never eligible-looking", () => {
    const m = matchOpportunity(strongProfile, record({ applicationDeadline: day(-3) }), NOW);
    expect(m.band).toBe("closed");
    expect(m.eligibility).toBe("not_eligible");
    expect(m.score).toBeLessThanOrEqual(SCORE_CAP_WHEN_INELIGIBLE);
    expect(m.missing[0]!.id).toBe("open");
  });
  it("a record flagged expired is closed even without a passed deadline", () => {
    expect(matchOpportunity(strongProfile, record({ verificationStatus: "expired" }), NOW).band).toBe("closed");
  });
  it("rolling and unknown deadlines stay open (with a note)", () => {
    const rolling = matchOpportunity(strongProfile, record({ deadlineType: "rolling", applicationDeadline: null }), NOW);
    expect(rolling.criteria[0]).toMatchObject({ id: "open", status: "met", detail: { note: "rolling" } });
    const unknown = matchOpportunity(strongProfile, record({ deadlineType: "unknown", applicationDeadline: null }), NOW);
    expect(unknown.criteria[0]!.detail.note).toBe("deadline_unknown");
  });
  it("the graduate rule: a master's student who has graduated qualifies for 'graduate' programmes, one who has not does not", () => {
    const grads = record({ educationLevels: ["graduate"] });
    expect(statusOf(matchOpportunity(profile({ ...strongProfile, graduationYear: 2024 }), grads, NOW), "education")).toBe("met");
    const notYet = matchOpportunity(profile({ ...strongProfile, graduationYear: 2028 }), grads, NOW);
    expect(statusOf(notYet, "education")).toBe("unmet");
    expect(notYet.eligibility).toBe("not_eligible");
    expect(notYet.missing[0]!.detail).toMatchObject({ note: "graduate_rule", year: 2028 });
  });
  it("the graduate rule needs the graduation year; without it the result is unknown, with a hint", () => {
    const m = matchOpportunity(profile({ ...strongProfile, graduationYear: null }), record({ educationLevels: ["graduate"] }), NOW);
    expect(statusOf(m, "education")).toBe("unknown");
    expect(m.unknown[0]!.detail.note).toBe("needs_graduation_year");
  });
  it("a high-school student is not a 'graduate'", () => {
    expect(statusOf(matchOpportunity(profile({ ...strongProfile, educationLevel: "high_school" }), record({ educationLevels: ["graduate"] }), NOW), "education")).toBe("unmet");
  });
});

describe("missing profile data", () => {
  it("is reported as unknown, never as a failure, and does not lower the score", () => {
    const sparse = profile({ educationLevel: "master", academicField: "ict", countryOfResidence: "AZ" });
    const m = matchOpportunity(sparse, record(), NOW);
    expect(m.eligibility).toBe("eligible");
    expect(m.score).toBe(100); // everything that could be evaluated is satisfied
    expect(m.unknown.map((c) => c.id).sort()).toEqual(["interests", "language", "location", "type"]);
    expect(m.completeness).toBeLessThan(100);
  });
  it("an empty profile yields 'unknown' eligibility and an 'insufficient data' band", () => {
    const m = matchOpportunity(emptyMatchProfile(), record(), NOW);
    expect(m.eligibility).toBe("unknown");
    expect(m.band).toBe("insufficient");
    expect(m.completeness).toBeLessThan(50);
    expect(m.missing).toEqual([]);
    expect(m.unknown.length).toBeGreaterThanOrEqual(5);
  });
  it("a null profile behaves like an empty one", () => {
    expect(matchOpportunity(toMatchProfile(null), record(), NOW)).toEqual(matchOpportunity(emptyMatchProfile(), record(), NOW));
  });
});

describe("preferences move the score but never eligibility", () => {
  const base = profile({ educationLevel: "master", academicField: "ict", countryOfResidence: "AZ" });
  it("a non-preferred type lowers the score, not the eligibility", () => {
    const m = matchOpportunity(profile({ ...base, preferredOpportunityTypes: ["internship"] }), record(), NOW);
    expect(m.eligibility).toBe("eligible");
    expect(statusOf(m, "type")).toBe("unmet");
    expect(m.score).toBeLessThan(100);
    expect(m.missing.map((c) => c.id)).toContain("type");
  });
  it("preferred countries: match, remote (partial), mismatch", () => {
    expect(statusOf(matchOpportunity(profile({ ...base, preferredCountries: ["DE", "FR"] }), record(), NOW), "location")).toBe("met");
    expect(statusOf(matchOpportunity(profile({ ...base, preferredCountries: ["FR"] }), record(), NOW), "location")).toBe("unmet");
    const remote = matchOpportunity(profile({ ...base, preferredCountries: ["FR"] }), record({ locationType: "remote" }), NOW);
    expect(remote.criteria.find((c) => c.id === "location")).toMatchObject({ status: "partial", detail: { note: "remote" } });
  });
  it("skills and interests are compared with the published text; matched terms are named", () => {
    const m = matchOpportunity(profile({ ...base, skills: ["Python", "Welding"], careerInterests: ["Data science"] }), record(), NOW);
    const c = m.criteria.find((x) => x.id === "interests")!;
    expect(c.status).toBe("met");
    expect(c.detail.matched).toEqual(["Python", "Data science"]);
    const none = matchOpportunity(profile({ ...base, skills: ["Welding"] }), record(), NOW);
    expect(statusOf(none, "interests")).toBe("unmet");
  });
  it("a single hit among several terms is partial credit", () => {
    const m = matchOpportunity(profile({ ...base, skills: ["Python", "Welding", "Painting"] }), record(), NOW);
    expect(statusOf(m, "interests")).toBe("partial");
  });
  it("skills cannot be compared when the record has almost no text", () => {
    const bare = record();
    bare.translations = [{ ...bare.translations[0]!, title: "Grant", shortDescription: null, description: null, requirements: null }];
    const m = matchOpportunity(profile({ ...base, skills: ["Python"] }), bare, NOW);
    expect(statusOf(m, "interests")).toBe("unknown");
  });
  it("languages: reads a published language well → met; only basic → partial; none → unmet", () => {
    expect(statusOf(matchOpportunity(profile({ ...base, languages: [{ code: "en", level: "B2" }] }), record(), NOW), "language")).toBe("met");
    expect(statusOf(matchOpportunity(profile({ ...base, languages: [{ code: "en", level: "A2" }] }), record(), NOW), "language")).toBe("partial");
    expect(statusOf(matchOpportunity(profile({ ...base, languages: [{ code: "de", level: "C1" }] }), record(), NOW), "language")).toBe("unmet");
  });
  it("only public translations count as published languages (machine drafts are ignored)", () => {
    const o = record();
    o.translations = [...o.translations, { ...o.translations[0]!, language: "ru", status: "machine_draft" }];
    expect(statusOf(matchOpportunity(profile({ ...base, languages: [{ code: "ru", level: "native" }] }), o, NOW), "language")).toBe("unmet");
  });
});

describe("score properties", () => {
  it("is always an integer from 0 to 100, for every demo record and a spread of profiles", () => {
    const profiles: MatchProfile[] = [
      emptyMatchProfile(),
      strongProfile,
      profile({ educationLevel: "high_school", academicField: "health", countryOfResidence: "US", preferredCountries: ["JP"], preferredOpportunityTypes: ["hackathon"] }),
      profile({ educationLevel: "phd", academicField: "natural_sciences", graduationYear: 1990, skills: ["x"], languages: [{ code: "xx", level: "A1" }] }),
    ];
    for (const p of profiles) {
      for (const r of getDemoRecords()) {
        const m = matchOpportunity(p, r, new Date());
        expect(Number.isInteger(m.score)).toBe(true);
        expect(m.score).toBeGreaterThanOrEqual(0);
        expect(m.score).toBeLessThanOrEqual(100);
        expect(m.completeness).toBeGreaterThanOrEqual(0);
        expect(m.completeness).toBeLessThanOrEqual(100);
        for (const c of m.criteria) {
          expect(c.earned).toBeGreaterThanOrEqual(0);
          expect(c.earned).toBeLessThanOrEqual(c.weight);
          expect(c.weight).toBe(WEIGHTS[c.id]);
          if (c.status === "unmet" || c.status === "unknown") expect(c.earned).toBe(0);
          if (c.status === "met") expect(c.earned).toBe(c.weight);
        }
        if (m.eligibility === "not_eligible") expect(m.score).toBeLessThanOrEqual(SCORE_CAP_WHEN_INELIGIBLE);
        // every criterion appears in exactly one of the three explanation lists
        expect(m.reasons.length + m.missing.length + m.unknown.length).toBe(m.criteria.length);
      }
    }
  });
  it("is deterministic and does not mutate its inputs", () => {
    const p = JSON.parse(JSON.stringify(strongProfile)) as MatchProfile;
    const r = record();
    const before = JSON.stringify(r);
    const a = matchOpportunity(p, r, NOW);
    const b = matchOpportunity(p, r, NOW);
    expect(a).toEqual(b);
    expect(p).toEqual(strongProfile);
    expect(JSON.stringify(r)).toBe(before);
  });
  it("improving the profile never lowers the score (monotonic for preferences)", () => {
    const r = record();
    const base = profile({ educationLevel: "master", academicField: "ict", countryOfResidence: "AZ" });
    const s0 = matchOpportunity(base, r, NOW).score;
    const s1 = matchOpportunity(profile({ ...base, preferredOpportunityTypes: ["scholarship"] }), r, NOW).score;
    const s2 = matchOpportunity(profile({ ...base, preferredOpportunityTypes: ["scholarship"], skills: ["Python"] }), r, NOW).score;
    expect(s1).toBeGreaterThanOrEqual(s0);
    expect(s2).toBeGreaterThanOrEqual(s1);
  });
  it("does not read name, university or any identity field (they are not even part of the input type)", () => {
    const keys = Object.keys(emptyMatchProfile()).sort();
    expect(keys).toEqual(["academicField", "careerInterests", "countryOfResidence", "educationLevel", "graduationYear", "languages", "preferredCountries", "preferredOpportunityTypes", "skills"]);
  });
  it("toMatchProfile drops private fields of a stored profile", () => {
    const projected = toMatchProfile({
      fullName: "Aysel Məmmədova", university: "Secret University", educationLevel: "master", academicField: "ict", graduationYear: 2027, countryOfResidence: "AZ",
      preferredCountries: ["DE"], skills: ["Python"], languages: [{ code: "en", level: "B2" }], careerInterests: [], preferredOpportunityTypes: ["scholarship"],
    });
    expect(JSON.stringify(projected)).not.toMatch(/Aysel|Secret University/);
  });
});

describe("needs manual review", () => {
  it("is flagged when the record has free-text requirements the engine cannot check", () => {
    expect(matchOpportunity(strongProfile, record({}, { requirements: "GPA above 3.5 and IELTS 6.5" }), NOW).needsManualReview).toBe(true);
    expect(matchOpportunity(strongProfile, record(), NOW).needsManualReview).toBe(false);
  });
});

describe("different user profiles on the demo catalogue", () => {
  const records = getDemoRecords();
  const now = new Date();
  const ictMaster = profile({ ...strongProfile, preferredCountries: ["AZ"], preferredOpportunityTypes: ["internship", "scholarship"] });
  const schoolLeaver = profile({ educationLevel: "high_school", academicField: "general", countryOfResidence: "AZ", preferredOpportunityTypes: ["summer_school"] });
  const wrongField = profile({ educationLevel: "phd", academicField: "arts_humanities", countryOfResidence: "AZ", preferredOpportunityTypes: ["research"] });

  it("ranks eligible matches first and closed ones last", () => {
    const ranked = rankMatches(ictMaster, records, now);
    const bands = ranked.map((r) => r.match.band);
    const firstIneligible = bands.findIndex((b) => b === "ineligible" || b === "closed");
    if (firstIneligible >= 0) expect(bands.slice(firstIneligible).every((b) => b === "ineligible" || b === "closed")).toBe(true);
    const closedAt = bands.indexOf("closed");
    if (closedAt >= 0) expect(bands.slice(closedAt).every((b) => b === "closed")).toBe(true);
    // within the eligible block the scores never increase
    const eligible = ranked.filter((r) => !["ineligible", "closed"].includes(r.match.band)).map((r) => r.match.score);
    expect(eligible).toEqual([...eligible].sort((a, b) => b - a));
  });
  it("expired demo records are always closed", () => {
    for (const p of [ictMaster, schoolLeaver, wrongField]) {
      for (const { record: r, match } of rankMatches(p, records, now)) if (r.slug.includes("expired")) expect(match.band).toBe("closed");
    }
  });
  it("different people get different top results", () => {
    const top = (p: MatchProfile) => rankMatches(p, records, now)[0]!.record.id;
    expect(new Set([top(ictMaster), top(schoolLeaver), top(wrongField)]).size).toBeGreaterThan(1);
  });
  it("someone whose field/level fit nothing sees low scores and explicit missing requirements", () => {
    const results = rankMatches(wrongField, records, now).filter((r) => r.match.eligibility === "not_eligible" && r.match.band !== "closed");
    expect(results.length).toBeGreaterThan(0);
    for (const { match } of results) expect(match.missing.some((c) => c.mandatory)).toBe(true);
  });
});

describe("termMatches", () => {
  it("matches word starts, folds diacritics and Azerbaijani letters, and treats short terms as whole words", () => {
    expect(termMatches("we teach programming", "program")).toBe(true);
    expect(termMatches(foldText("Təqaüd proqramı"), "TEQAUD")).toBe(true);
    expect(termMatches(foldText("Təqaüd proqramı"), "Təqaüd")).toBe(true);
    expect(termMatches("the main rain", "ai")).toBe(false);
    expect(termMatches("applied ai research", "ai")).toBe(true);
    expect(termMatches("anything", "")).toBe(false);
    expect(termMatches("x", "x")).toBe(false);
    expect(termMatches("c# developers", "c#")).toBe(true);
  });
  it("is safe with regex metacharacters", () => {
    expect(termMatches("text", ".*")).toBe(false);
    expect(termMatches("a (b) c", "(b)")).toBe(true);
  });
});

import az from "@/messages/az.json";
import en from "@/messages/en.json";
import ru from "@/messages/ru.json";
import { CRITERION_VARIANTS, criterionMessageKey } from "./describe";

describe("every explanation the engine can produce has text in all three languages", () => {
  const profiles: MatchProfile[] = [
    emptyMatchProfile(),
    strongProfile,
    profile({ ...strongProfile, educationLevel: "bachelor", graduationYear: 2030, languages: [{ code: "en", level: "A1" }], skills: ["welding"], preferredCountries: ["JP"], preferredOpportunityTypes: ["hackathon"], countryOfResidence: "US", academicField: "health" }),
    profile({ educationLevel: "master", graduationYear: null }),
    profile({ educationLevel: "phd", graduationYear: 2020, skills: ["python", "welding", "x1"] }),
  ];
  const variants: ReturnType<typeof record>[] = [
    record(), record({ educationLevels: ["graduate"] }), record({ locationType: "remote" }), record({ deadlineType: "rolling", applicationDeadline: null }),
    record({ deadlineType: "unknown", applicationDeadline: null }), record({ applicationDeadline: day(-1) }), record({ applicationStartDate: day(3) }),
    ...getDemoRecords(),
  ];
  const lookup = (messages: unknown, key: string) => key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);

  it("maps every produced criterion to a known variant that exists in az, ru and en", () => {
    const seen = new Set<string>();
    for (const p of profiles) for (const r of variants) for (const c of matchOpportunity(p, r, NOW).criteria) seen.add(criterionMessageKey(c));
    expect(seen.size).toBeGreaterThan(15);
    for (const key of seen) {
      expect(CRITERION_VARIANTS.has(key), key).toBe(true);
      for (const [name, messages] of [["az", az], ["ru", ru], ["en", en]] as const) expect(typeof lookup(messages.matching.criteria, key), `${name}:${key}`).toBe("string");
    }
  });
  it("has text for every declared variant, band, eligibility and criterion name", () => {
    for (const key of CRITERION_VARIANTS) for (const m of [az, ru, en]) expect(typeof lookup(m.matching.criteria, key), key).toBe("string");
    for (const m of [az, ru, en]) {
      for (const band of ["strong", "good", "partial", "low", "insufficient", "ineligible", "closed"]) expect(typeof lookup(m.matching.band, band)).toBe("string");
      for (const e of ["eligible", "not_eligible", "unknown"]) expect(typeof lookup(m.matching.eligibility, e)).toBe("string");
      for (const id of ["open", "education", "field", "country", "type", "location", "interests", "language"]) expect(typeof lookup(m.matching.criterionName, id)).toBe("string");
    }
  });
});
