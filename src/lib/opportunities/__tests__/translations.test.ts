import { describe, expect, it } from "vitest";
import { getContentFallbackChain, getLanguageName, normalizeLanguage } from "@/i18n/content-language";
import {
  applyOriginalEdit, getAvailableLanguages, getTranslationCoverage, isTranslationComplete, isTranslationOutdated, resolveContent,
} from "../translations";
import { makeRecord, makeTranslation } from "./factories";

const az = makeTranslation({ language: "az", status: "original", translatedFrom: null, title: "AZ başlıq", shortDescription: "AZ qısa",
  description: "AZ təsvir", requirements: "AZ tələb", benefits: "AZ üstünlük", eligibility: "AZ uyğunluq" });

describe("resolveContent", () => {
  it("uses the requested language when it is complete, with no fallback", () => {
    const en = makeTranslation({ language: "en", title: "EN title", shortDescription: "EN short", description: "EN desc", requirements: "EN req", benefits: "EN ben", eligibility: "EN elig" });
    const r = resolveContent(makeRecord({ translations: [az, en] }), "en");
    expect(r.title).toMatchObject({ value: "EN title", language: "en", isFallback: false });
    expect(r.isFullyInRequestedLanguage).toBe(true);
    expect(r.fallbackFields).toEqual([]);
  });

  it("falls back FIELD BY FIELD to the original and labels each field's language", () => {
    const en = makeTranslation({ language: "en", title: "EN title", shortDescription: "EN short", description: null });
    const r = resolveContent(makeRecord({ translations: [az, en] }), "en");
    expect(r.title.language).toBe("en");
    expect(r.description).toMatchObject({ value: "AZ təsvir", language: "az", isFallback: true });
    expect(r.requirements?.language).toBe("az");
    expect(r.fallbackFields).toEqual(["description", "requirements", "benefits", "eligibility"]);
    expect(r.languagesUsed).toEqual(["en", "az"]);
    expect(r.isFullyInRequestedLanguage).toBe(false);
  });

  it("shows the whole original, labelled, when the requested translation does not exist", () => {
    const r = resolveContent(makeRecord({ translations: [az] }), "ru");
    expect(r.title).toMatchObject({ value: "AZ başlıq", language: "az", isFallback: true });
    expect(r.fallbackFields).toContain("title");
  });

  it("treats empty / whitespace-only translated fields as missing, not as text", () => {
    const en = makeTranslation({ language: "en", title: "EN title", shortDescription: "   " });
    expect(resolveContent(makeRecord({ translations: [az, en] }), "en").shortDescription?.language).toBe("az");
  });

  it("NEVER shows a machine_draft", () => {
    const ru = makeTranslation({ language: "ru", status: "machine_draft", title: "RU draft", shortDescription: "RU draft short" });
    const r = resolveContent(makeRecord({ translations: [az, ru] }), "ru");
    expect(r.title.value).toBe("AZ başlıq");
    expect(JSON.stringify(r)).not.toContain("RU draft");
    expect(getAvailableLanguages(makeRecord({ translations: [az, ru] }))).toEqual(["az"]);
  });

  it("never invents text: fields missing everywhere are omitted and reported", () => {
    const bare = makeTranslation({ language: "az", status: "original", translatedFrom: null, title: "T", shortDescription: "S" });
    const r = resolveContent(makeRecord({ translations: [bare] }), "az");
    expect(r.description).toBeNull();
    expect(r.missingFields).toEqual(["description", "requirements", "benefits", "eligibility"]);
  });

  it("does NOT chain through other translations (en request, ru exists, original az → az, not ru)", () => {
    const ru = makeTranslation({ language: "ru", title: "RU", shortDescription: "RU s", description: "RU desc" });
    const r = resolveContent(makeRecord({ translations: [az, ru] }), "en");
    expect(r.description?.language).toBe("az");
    expect(getContentFallbackChain("en", "az")).toEqual(["en", "az"]);
  });

  it("supports an original language that is not an interface language (German)", () => {
    const de = makeTranslation({ language: "de", status: "original", translatedFrom: null, title: "DE Titel", shortDescription: "DE kurz" });
    const r = resolveContent(makeRecord({ originalLanguage: "de", translations: [de] }), "ru");
    expect(r.title).toMatchObject({ value: "DE Titel", language: "de", isFallback: true });
    expect(getLanguageName("de")).toBe("Deutsch");
  });

  it("flags machine-approved and outdated text so the UI can add notices", () => {
    const en = makeTranslation({ language: "en", status: "machine_approved", title: "EN", shortDescription: "EN s" });
    expect(resolveContent(makeRecord({ translations: [az, en] }), "en").hasMachineTranslation).toBe(true);
    const old = makeTranslation({ language: "en", status: "outdated", title: "EN", shortDescription: "EN s" });
    expect(resolveContent(makeRecord({ translations: [az, old] }), "en").hasOutdatedTranslation).toBe(true);
  });

  it("falls back to the slug only for corrupt data with no public title at all", () => {
    expect(resolveContent(makeRecord({ translations: [] }), "en").title.value).toBe("test-opportunity");
  });
});

describe("translation lifecycle", () => {
  it("applyOriginalEdit bumps the version, outdates reviewed translations and leaves drafts alone", () => {
    const en = makeTranslation({ language: "en", status: "human" });
    const ru = makeTranslation({ language: "ru", status: "machine_draft" });
    const edited = applyOriginalEdit(makeRecord({ translations: [az, en, ru], contentVersion: 1 }));
    expect(edited.contentVersion).toBe(2);
    expect(edited.translations.map((t) => [t.language, t.status])).toEqual([["az", "original"], ["en", "outdated"], ["ru", "machine_draft"]]);
    expect(edited.translations[0]!.sourceVersion).toBe(2);
  });
  it("isTranslationOutdated compares source versions", () => {
    expect(isTranslationOutdated({ status: "human", sourceVersion: 1 }, 2)).toBe(true);
    expect(isTranslationOutdated({ status: "original", sourceVersion: 1 }, 2)).toBe(false);
  });
  it("coverage reports partial translations", () => {
    const en = makeTranslation({ language: "en", title: "T", shortDescription: "S" });
    const record = makeRecord({ translations: [az, en] });
    const [enCov] = getTranslationCoverage(record, ["en"]);
    expect(enCov).toMatchObject({ filled: 2, expected: 6, isPublic: true });
    expect(isTranslationComplete(record, "en")).toBe(false);
    expect(isTranslationComplete(record, "az")).toBe(true);
  });
});

describe("content-language helpers", () => {
  it("normalizes language tags", () => {
    expect(normalizeLanguage("ru-RU")).toBe("ru");
    expect(normalizeLanguage(" EN ")).toBe("en");
    expect(normalizeLanguage("not a language")).toBeNull();
    expect(normalizeLanguage(null)).toBeNull();
  });
  it("fallback chain has no duplicate when requested equals original", () => expect(getContentFallbackChain("az", "az")).toEqual(["az"]));
});
