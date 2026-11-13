import { describe, expect, it } from "vitest";
import { ALL_COLUMNS, buildTemplateCsv, fieldToColumn } from "./columns";
import { csvCell, CSV_LIMITS, parseCsv } from "./csv";
import { findDuplicates, titleSimilarity, type DuplicateIndexEntry } from "./duplicates";
import { checkOfficialUrl, normalizeUrl, registrableDomain } from "./urls";
import { toFormDateTime, validateImport, type ImportContext, type ImportPreview } from "./validate";

const NOW = new Date("2026-06-15T12:00:00Z");
const ORG = { id: "org-1", slug: "tu-berlin", name: "Technical University of Berlin" };
const ORG2 = { id: "org-2", slug: "bank-of-az", name: "Bank of Azerbaijan" };

const context = (over: Partial<ImportContext> = {}): ImportContext => ({
  organizations: [ORG, ORG2],
  sources: [{ id: "src-1", websiteUrl: "https://www.tu-berlin.de", organizationName: "TU Berlin", isActive: true }, { id: "src-2", websiteUrl: "https://bank.az", organizationName: "Bank of Azerbaijan", isActive: false }],
  index: [],
  now: NOW,
  ...over,
});

const HEADER = ALL_COLUMNS.join(",");
function row(values: Record<string, string>): string {
  return ALL_COLUMNS.map((c) => csvCell(values[c] ?? "")).join(",");
}
const good = (over: Record<string, string> = {}) => ({
  organization: "tu-berlin", opportunity_type: "scholarship", location_type: "onsite", country: "DE", official_source_url: "https://www.tu-berlin.de/programs/stipend",
  deadline_type: "fixed", deadline: "2026-12-31", deadline_timezone: "Europe/Berlin", original_language: "en", education_levels: "master|phd",
  title_en: "Master's stipend", short_en: "Funding for master's students.", ...over,
});
const file = (...rows: Record<string, string>[]) => [HEADER, ...rows.map(row)].join("\r\n");
const only = (preview: ImportPreview, i = 0) => preview.rows[i]!;
const codes = (r: { issues: { code: string }[] }) => r.issues.map((i) => i.code);

describe("CSV reader", () => {
  it("parses quotes, doubled quotes, line breaks inside cells and CRLF", () => {
    const r = parseCsv('a,b,c\r\n1,"two, with comma","line1\nline2"\r\n"say ""hi""",,x');
    expect(r.headers).toEqual(["a", "b", "c"]);
    expect(r.rows.map((x) => x.cells)).toEqual([["1", "two, with comma", "line1\nline2"], ['say "hi"', "", "x"]]);
    expect(r.rows.map((x) => x.line)).toEqual([2, 4]); // the second row starts on line 4 because of the break inside the first
  });
  it("detects the semicolon delimiter (Excel in az/ru locales) and tabs; strips the BOM; lowercases headers", () => {
    expect(parseCsv("﻿Slug;Title\n1;a").headers).toEqual(["slug", "title"]);
    expect(parseCsv("Slug;Title\n1;a").delimiter).toBe(";");
    expect(parseCsv("a\tb\n1\t2").delimiter).toBe("\t");
    expect(parseCsv('"a;b",c\n1,2').delimiter).toBe(","); // a delimiter inside quotes does not count
  });
  it("skips blank lines and reports problems instead of throwing", () => {
    expect(parseCsv("a,b\n\n1,2\n,\n").rows).toHaveLength(1);
    expect(parseCsv("").problems).toContain("empty");
    expect(parseCsv("   \n  ").problems).toContain("empty");
    expect(parseCsv('a,b\n"unterminated,2').problems).toContain("unclosed_quote");
    expect(parseCsv("a,b\n1,\u0000").problems).toContain("binary");
    expect(parseCsv("x".repeat(CSV_LIMITS.maxBytes + 1)).problems).toContain("too_large");
    const many = ["a", ...Array.from({ length: CSV_LIMITS.maxRows + 5 }, (_, i) => String(i))].join("\n");
    const parsed = parseCsv(many);
    expect(parsed.problems).toContain("too_many_rows");
    expect(parsed.rows).toHaveLength(CSV_LIMITS.maxRows);
  });
  it("writing guards cells that a spreadsheet could run as formulas", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('q"x')).toBe('"q""x"');
  });
});

describe("the template", () => {
  it("is a valid CSV with every column, and its example row is REFUSED by the importer", () => {
    const template = buildTemplateCsv();
    expect(template.startsWith("﻿")).toBe(true);
    const parsed = parseCsv(template);
    expect(parsed.headers).toEqual(ALL_COLUMNS);
    expect(parsed.rows).toHaveLength(1);
    const preview = validateImport(template, context({ organizations: [{ id: "x", slug: "exact-organization-slug-or-name", name: "Any" }] }));
    expect(only(preview).status).toBe("error");
    expect(codes(only(preview))).toEqual(expect.arrayContaining(["example_row", "url_placeholder_domain"]));
    expect(preview.summary.importable).toBe(0);
  });
  it("has columns for original text and translations in az, ru and en, plus the source and the review flag", () => {
    for (const c of ["organization", "source", "official_source_url", "original_language", "translations_reviewed", "title_az", "title_ru", "title_en", "short_az", "eligibility_ru", "benefits_en"]) expect(ALL_COLUMNS).toContain(c);
    expect(ALL_COLUMNS).not.toContain("publication_status"); // imports can never choose a status
    expect(ALL_COLUMNS).not.toContain("verification_status");
    expect(ALL_COLUMNS).not.toContain("last_verified_at");
  });
  it("maps form fields back to CSV columns", () => {
    expect(fieldToColumn("t_ru_short")).toBe("short_ru");
    expect(fieldToColumn("officialSourceUrl")).toBe("official_source_url");
    expect(fieldToColumn("t_az_status")).toBe("translations_reviewed");
  });
});

describe("source URLs (offline checks only)", () => {
  it("accepts an ordinary official https URL", () => expect(checkOfficialUrl("https://www.tu-berlin.de/programs")).toEqual([]));
  it.each([
    ["http://tu-berlin.de", ["not_https"]], ["not a url", ["invalid"]], ["https://user:pw@tu-berlin.de/x", ["credentials"]], ["https://192.0.2.10/x", ["ip_address"]],
    ["https://127.0.0.1/x", ["local_address"]], ["https://10.1.2.3/x", ["local_address"]], ["https://localhost/x", ["local_address"]], ["https://intranet.local/x", ["local_address"]],
    ["https://www.example.com/page", ["placeholder_domain"]], ["https://[::1]/x", ["local_address", "ip_address"]],
  ])("rejects %s", (url, expected) => expect(checkOfficialUrl(url)).toEqual(expect.arrayContaining(expected.slice(0, 1))));
  it("warns about shorteners, social media and file sharing (not official pages)", () => {
    expect(checkOfficialUrl("https://bit.ly/abc")).toEqual(["url_shortener"]);
    expect(checkOfficialUrl("https://www.facebook.com/uni")).toEqual(["social_media"]);
    expect(checkOfficialUrl("https://t.me/channel")).toEqual(["social_media"]);
    expect(checkOfficialUrl("https://drive.google.com/file/d/1")).toEqual(["file_sharing"]);
  });
  it("warns when the host differs from every registered source (registrable-domain comparison)", () => {
    expect(checkOfficialUrl("https://www.tu-berlin.de/x", ["tu-berlin.de"])).toEqual([]);
    expect(checkOfficialUrl("https://admissions.tu-berlin.de/x", ["www.tu-berlin.de"])).toEqual([]);
    expect(checkOfficialUrl("https://other-site.org/x", ["tu-berlin.de"])).toEqual(["host_mismatch"]);
    expect(checkOfficialUrl("https://sub.edu.gov.az/x", ["edu.gov.az"])).toEqual([]);
    expect(checkOfficialUrl("https://moe.gov.az/x", ["edu.gov.az"])).toEqual(["host_mismatch"]); // two different ministries
  });
  it("computes registrable domains incl. Azerbaijani and UK second-level suffixes", () => {
    expect(registrableDomain("www.edu.gov.az")).toBe("edu.gov.az");
    expect(registrableDomain("a.b.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("bank.az")).toBe("bank.az");
    expect(registrableDomain("WWW.Example.COM.")).toBe("example.com");
  });
  it("normalises links to the same page", () => {
    const a = normalizeUrl("https://WWW.Example.org/Program/?utm_source=x&b=2&a=1#section");
    expect(a).toBe(normalizeUrl("https://example.org/Program?a=1&b=2"));
    expect(normalizeUrl("https://example.org/p/")).toBe(normalizeUrl("https://example.org/p"));
    expect(normalizeUrl("https://example.org/p")).not.toBe(normalizeUrl("https://example.org/q"));
    expect(normalizeUrl("nonsense")).toBeNull();
  });
});

describe("duplicate detection", () => {
  const index: DuplicateIndexEntry[] = [
    { id: "e1", slug: "existing-one", organizationId: "org-1", officialSourceUrl: "https://tu-berlin.de/programs/stipend", applicationDeadline: null, status: "published", titles: ["Master's stipend", "Magistr təqaüdü"] },
    { id: "e2", slug: "existing-two", organizationId: "org-1", officialSourceUrl: null, applicationDeadline: null, status: "draft", titles: ["Summer school in data science"] },
  ];
  const cand = (over = {}) => ({ slug: "new-slug", organizationId: "org-1", officialSourceUrl: "https://other.example.org/x", applicationDeadline: null, titles: ["Something else"], ...over });
  it("same official page → exact (even with www, tracking parameters and a trailing slash)", () => {
    const m = findDuplicates(cand({ officialSourceUrl: "https://www.tu-berlin.de/programs/stipend/?utm_campaign=z" }), index);
    expect(m).toEqual([expect.objectContaining({ id: "e1", reason: "same_url", level: "exact" })]);
  });
  it("same slug → exact", () => expect(findDuplicates(cand({ slug: "existing-two" }), index)[0]).toMatchObject({ id: "e2", reason: "same_slug", level: "exact" }));
  it("similar title in the same organization → possible; in another organization → not a duplicate", () => {
    expect(findDuplicates(cand({ titles: ["Summer School in Data Science!"] }), index)[0]).toMatchObject({ id: "e2", level: "possible", reason: "similar_title" });
    expect(findDuplicates(cand({ organizationId: "org-9", titles: ["Summer school in data science"] }), index)).toEqual([]);
    expect(findDuplicates(cand({ titles: ["Winter school in chemistry"] }), index)).toEqual([]);
  });
  it("compares titles in any language, ignoring case and accents", () => {
    expect(findDuplicates(cand({ titles: ["MAGISTR TEQAUDU"] }), index)[0]).toMatchObject({ id: "e1", level: "possible" });
    expect(titleSimilarity("Təqaüd", "teqaud")).toBe(1);
    expect(titleSimilarity("", "x")).toBe(0);
  });
  it("lists exact matches before possible ones", () => {
    const m = findDuplicates(cand({ slug: "existing-two", officialSourceUrl: "https://tu-berlin.de/programs/stipend", titles: ["Master's stipend"] }), index);
    expect(m.map((x) => x.level)).toEqual(["exact", "exact"]);
  });
});

describe("dates people type", () => {
  it("accepts ISO and dotted dates, with or without a time; date-only means the end of the day", () => {
    expect(toFormDateTime("2030-03-31")).toBe("2030-03-31T23:59");
    expect(toFormDateTime("2030-03-31 18:30")).toBe("2030-03-31T18:30");
    expect(toFormDateTime("31.03.2030")).toBe("2030-03-31T23:59");
    expect(toFormDateTime("1.3.2030 9:05")).toBe("2030-03-01T09:05");
    expect(toFormDateTime("2030-03-31", "00:00")).toBe("2030-03-31T00:00");
    expect(toFormDateTime("")).toBe("");
    expect(toFormDateTime("next week")).toBe("next week");
  });
});

describe("import validation", () => {
  it("a good row is importable, as a draft input with the deadline converted from the organization's time zone", () => {
    const p = validateImport(file(good()), context());
    const r = only(p);
    expect(r.status).toBe("warning"); // translations are missing: reported, never invented
    expect(r.input).toMatchObject({ organizationId: "org-1", opportunityType: "scholarship", country: "DE", educationLevels: ["master", "phd"], originalLanguage: "en", deadlineType: "fixed", slug: "master-s-stipend" });
    expect(r.input!.applicationDeadline).toBe("2026-12-31T22:59:00.000Z"); // 23:59 in Berlin (CET)
    expect(r.input!.translations).toEqual([expect.objectContaining({ language: "en", status: "original", title: "Master's stipend" })]);
    expect(codes(r)).toEqual(expect.arrayContaining(["translation_missing"]));
    expect(r.sourceId).toBe("src-1"); // linked by host
    expect(p.summary).toMatchObject({ total: 1, importable: 1, error: 0 });
  });
  it("never invents anything: empty cells stay empty, no status/verification can come from the file", () => {
    const r = only(validateImport(file(good({ funding_type: "" })), context()));
    expect(r.input).toMatchObject({ fundingType: "not_specified", fundingAmount: null });
    expect(r.input!.translations[0]).toMatchObject({ description: null, requirements: null, benefits: null, eligibility: null });
    expect(JSON.stringify(r.input)).not.toMatch(/published|verified/);
  });
  it("imports translations as MACHINE DRAFTS unless the file says a person reviewed them", () => {
    const withTranslations = good({ title_az: "Magistr təqaüdü", short_az: "qısa", title_ru: "Стипендия магистра" });
    const draft = only(validateImport(file(withTranslations), context()));
    expect(draft.input!.translations.map((t) => `${t.language}:${t.status}`).sort()).toEqual(["az:machine_draft", "en:original", "ru:machine_draft"]);
    expect(codes(draft)).toContain("translations_unreviewed");
    const reviewed = only(validateImport(file({ ...withTranslations, translations_reviewed: "yes" }), context()));
    expect(reviewed.input!.translations.map((t) => `${t.language}:${t.status}`).sort()).toEqual(["az:human", "en:original", "ru:human"]);
    expect(codes(reviewed)).not.toContain("translations_unreviewed");
    expect(codes(reviewed)).not.toContain("translation_missing");
  });
  it("supports any of az / ru / en as the ORIGINAL language, preserved with its own text", () => {
    const r = only(validateImport(file(good({ original_language: "az", title_en: "", short_en: "", title_az: "Orijinal başlıq", short_az: "qısa" })), context()));
    expect(r.input).toMatchObject({ originalLanguage: "az" });
    expect(r.input!.translations[0]).toMatchObject({ language: "az", status: "original", title: "Orijinal başlıq" });
    const de = only(validateImport(file(good({ original_language: "de" })), context()));
    expect(de.status).toBe("error");
    expect(codes(de)).toContain("original_language_unsupported");
  });
  it("requires an official source, and checks it", () => {
    expect(codes(only(validateImport(file(good({ official_source_url: "" })), context())))).toContain("official_source_required");
    expect(codes(only(validateImport(file(good({ official_source_url: "http://tu-berlin.de/x" })), context())))).toContain("invalid_url");
    expect(codes(only(validateImport(file(good({ official_source_url: "https://bit.ly/x" })), context())))).toContain("url_url_shortener");
    const social = only(validateImport(file(good({ official_source_url: "https://www.facebook.com/tu" })), context()));
    expect(social.issues.find((i) => i.code === "url_social_media")).toMatchObject({ severity: "warning", column: "official_source_url" });
    expect(codes(only(validateImport(file(good({ official_source_url: "https://other-site.org/x" })), context())))).toContain("url_host_mismatch");
    expect(only(validateImport(file(good({ official_source_url: "https://127.0.0.1/x" })), context())).status).toBe("error");
  });
  it("validates deadlines: fixed needs a date, rolling must not have one, past and far-future are flagged, unknown is flagged", () => {
    expect(codes(only(validateImport(file(good({ deadline: "" })), context())))).toContain("deadline_required");
    expect(codes(only(validateImport(file(good({ deadline_type: "rolling", deadline: "2030-01-01" })), context())))).toContain("deadline_not_allowed");
    expect(codes(only(validateImport(file(good({ deadline: "2027-02-30" })), context())))).toContain("invalid_date");
    expect(codes(only(validateImport(file(good({ deadline: "tomorrow" })), context())))).toContain("invalid_date");
    const past = only(validateImport(file(good({ deadline: "2026-01-10" })), context()));
    expect(past.status).toBe("warning"); // importable: it will simply show as expired
    expect(codes(past)).toContain("deadline_in_past");
    expect(codes(only(validateImport(file(good({ deadline: "2031-01-01" })), context())))).toContain("deadline_far_future");
    expect(codes(only(validateImport(file(good({ deadline_type: "unknown", deadline: "" })), context())))).toContain("deadline_unknown");
    expect(codes(only(validateImport(file(good({ deadline_type: "rolling", deadline: "" })), context())))).not.toContain("deadline_unknown");
    expect(codes(only(validateImport(file(good({ start_date: "2027-02-01" })), context())))).toContain("dates_out_of_order");
    expect(only(validateImport(file(good({ deadline: "31.12.2026" })), context())).input!.applicationDeadline).toBe("2026-12-31T22:59:00.000Z");
  });
  it("resolves the organization by slug or exact (case/accent-insensitive) name, and never creates one", () => {
    expect(only(validateImport(file(good({ organization: "Technical University of Berlin" })), context())).input!.organizationId).toBe("org-1");
    expect(only(validateImport(file(good({ organization: "technical university of BERLIN" })), context())).input!.organizationId).toBe("org-1");
    const missing = only(validateImport(file(good({ organization: "Unknown Institute" })), context()));
    expect(missing.status).toBe("error");
    expect(missing.issues.find((i) => i.code === "organization_not_found")).toMatchObject({ column: "organization", params: { value: "Unknown Institute" } });
    expect(codes(only(validateImport(file(good({ organization: "" })), context())))).toContain("organization_required");
  });
  it("maps validation errors to the CSV column and keeps parameters (limits)", () => {
    const r = only(validateImport(file(good({ opportunity_type: "teleport", country: "XX", funding_type: "paid", funding_amount: "-5", title_en: "x".repeat(201) })), context()));
    expect(r.issues.filter((i) => i.severity === "error").map((i) => `${i.column}:${i.code}`)).toEqual(expect.arrayContaining(["opportunity_type:invalid_choice", "country:invalid_country", "funding_amount:invalid_amount", "title_en:text_too_long"]));
    expect(r.issues.find((i) => i.code === "text_too_long")!.params).toEqual({ max: 200 });
    expect(r.input).toBeNull();
  });
  it("detects duplicates against the catalogue", () => {
    const index: DuplicateIndexEntry[] = [{ id: "e1", slug: "x", organizationId: "org-1", officialSourceUrl: "https://tu-berlin.de/programs/stipend", applicationDeadline: null, status: "published", titles: ["Whatever"] }];
    const r = only(validateImport(file(good()), context({ index })));
    expect(r.status).toBe("duplicate");
    expect(r.duplicates[0]).toMatchObject({ id: "e1", reason: "same_url", level: "exact" });
  });
  it("detects duplicates WITHIN the file, naming the earlier line", () => {
    const p = validateImport(file(good(), good({ title_en: "Another title" }), good({ official_source_url: "https://tu-berlin.de/other", title_en: "Master's stipend" })), context());
    expect(p.rows.map((r) => r.status)).toEqual(["warning", "duplicate", "possible_duplicate"]);
    expect(p.rows[1]!.duplicates[0]).toMatchObject({ reason: "same_url", inFileLine: 2 });
    expect(p.rows[2]!.duplicates[0]).toMatchObject({ reason: "similar_title", inFileLine: 2 });
    expect(p.summary).toMatchObject({ total: 3, importable: 1, duplicate: 1, possibleDuplicate: 1 });
  });
  it("gives imported records unique slugs (generated slugs never clash; an explicit slug that clashes is a duplicate)", () => {
    const index: DuplicateIndexEntry[] = [{ id: "e9", slug: "master-s-stipend", organizationId: "org-9", officialSourceUrl: null, applicationDeadline: null, status: "draft", titles: [] }];
    const generated = only(validateImport(file(good()), context({ index })));
    expect(generated.status).not.toBe("duplicate");
    expect(generated.input!.slug).toMatch(/^master-s-stipend-\d+$/);
    const explicit = only(validateImport(file(good({ slug: "master-s-stipend" })), context({ index })));
    expect(explicit.status).toBe("duplicate");
    expect(codes(only(validateImport(file(good({ slug: "Bad Slug" })), context())))).toContain("invalid_slug");
  });
  it("links the source: by name or URL when given, by host otherwise; unknown sources are a warning, inactive ones too", () => {
    expect(only(validateImport(file(good({ source: "TU Berlin" })), context())).sourceId).toBe("src-1");
    expect(only(validateImport(file(good({ source: "https://tu-berlin.de" })), context())).sourceId).toBe("src-1");
    const unknown = only(validateImport(file(good({ source: "Made Up Source" })), context()));
    expect(unknown.sourceId).toBeNull();
    expect(codes(unknown)).toContain("source_unknown");
    const unlinked = only(validateImport(file(good({ official_source_url: "https://www.mit.edu/x" })), context({ sources: [] })));
    expect(codes(unlinked)).toContain("source_unlinked");
    const inactive = only(validateImport(file(good({ organization: "bank-of-az", official_source_url: "https://bank.az/loans", source: "Bank of Azerbaijan" })), context()));
    expect(codes(inactive)).toContain("source_inactive");
  });
  it("flags missing short descriptions (needed later for publication)", () => {
    expect(codes(only(validateImport(file(good({ short_en: "" })), context())))).toContain("short_description_missing");
  });
  it("reports file-level problems and bad headers before any row", () => {
    expect(validateImport("", context()).fileProblems).toContain("empty");
    expect(validateImport('a,b\n"x', context()).fileProblems).toContain("unclosed_quote");
    const missing = validateImport("slug,title_en\nx,y", context());
    expect(missing.missingColumns).toEqual(expect.arrayContaining(["organization", "official_source_url"]));
    expect(missing.rows).toEqual([]);
    const unknown = validateImport(`${HEADER},surprise\r\n${row(good())},1`, context());
    expect(unknown.unknownColumns).toEqual(["surprise"]);
    expect(unknown.rows).toHaveLength(1);
    expect(validateImport(`${HEADER},slug\r\n`, context()).duplicateColumns).toEqual(["slug"]);
    const noTitles = validateImport("organization,opportunity_type,location_type,official_source_url,deadline_type,original_language\nx,y,z,w,v,u", context());
    expect(noTitles.missingColumns).toContain("title_az");
  });
  it("rejects rows with extra cells, and works with a semicolon-delimited, BOM-prefixed file", () => {
    const semicolon = `﻿${ALL_COLUMNS.join(";")}\r\n${ALL_COLUMNS.map((c) => csvCell(good()[c as keyof ReturnType<typeof good>] ?? "")).join(";")}`;
    const p = validateImport(semicolon, context());
    expect(p.delimiter).toBe(";");
    expect(only(p).input).not.toBeNull();
    const extra = validateImport(`${HEADER}\r\n${row(good())},surplus`, context());
    expect(codes(only(extra))).toContain("too_many_cells");
  });
  it("reads a realistic mixed file: ok, warning, error, duplicate and a possible duplicate", () => {
    const index: DuplicateIndexEntry[] = [{ id: "e1", slug: "old", organizationId: "org-2", officialSourceUrl: "https://bank.az/internship", applicationDeadline: null, status: "published", titles: ["Summer internship programme"] }];
    const p = validateImport(
      file(
        good({ title_en: "Full row", short_en: "ok", title_az: "Tam", short_az: "q", title_ru: "Полная", short_ru: "к", translations_reviewed: "yes" }),
        good({ title_en: "Needs more", official_source_url: "https://www.tu-berlin.de/two" }),
        good({ title_en: "Broken", opportunity_type: "nonsense", official_source_url: "https://www.tu-berlin.de/three" }),
        good({ organization: "bank-of-az", official_source_url: "https://bank.az/internship", title_en: "Whatever" }),
        good({ organization: "bank-of-az", official_source_url: "https://bank.az/new-page", title_en: "Summer internship programme" }),
      ),
      context({ index }),
    );
    expect(p.rows.map((r) => r.status)).toEqual(["ok", "warning", "error", "duplicate", "possible_duplicate"]);
    expect(p.summary).toEqual({ total: 5, ok: 1, warning: 1, error: 1, duplicate: 1, possibleDuplicate: 1, importable: 2 });
  });
});
