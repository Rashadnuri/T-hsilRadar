import { isValidSlug, uniqueSlug } from "@/lib/opportunities/slug";
import { type OpportunityFormInput } from "@/types/admin";
import { parseOpportunityForm } from "@/validation/admin";
import { foldText } from "@/utils/fold-text";
import { parseCsv, type CsvProblem } from "./csv";
import { ALL_COLUMNS, BASE_COLUMNS, fieldToColumn, IMPORT_LANGUAGES, REQUIRED_COLUMNS, TEXT_FIELDS } from "./columns";
import { findDuplicates, type DuplicateIndexEntry, type DuplicateMatch } from "./duplicates";
import { checkOfficialUrl, normalizeUrl, parseHost, URL_ERRORS } from "./urls";

/**
 * Validation of an import file, BEFORE anything is saved. The result drives the preview (every row,
 * every problem, in the admin's language) and, on confirmation, the commit, which runs this same
 * function again on the server: the browser's preview is never trusted.
 *
 * Principles: nothing is invented (an empty cell stays empty), nothing is published or verified,
 * and the official source is mandatory.
 */

export interface ImportOrganization { id: string; slug: string; name: string }
export interface ImportSourceRef { id: string; websiteUrl: string; organizationName: string; isActive: boolean }

export interface ImportContext {
  organizations: readonly ImportOrganization[];
  sources: readonly ImportSourceRef[];
  index: readonly DuplicateIndexEntry[];
  now?: Date;
}

export interface ImportIssue {
  severity: "error" | "warning";
  /** "validation" = a form validation code (messages `validation.*`); "import" = an import code (messages `admin.import.issues.*`). */
  kind: "validation" | "import";
  code: string;
  column?: string;
  params?: Record<string, string | number>;
}

export type ImportRowStatus = "ok" | "warning" | "error" | "duplicate" | "possible_duplicate";

export interface ImportRow {
  line: number;
  status: ImportRowStatus;
  title: string;
  organization: string;
  issues: ImportIssue[];
  duplicates: (DuplicateMatch & { inFileLine?: number })[];
  /** What would be saved (null when the row has errors). */
  input: OpportunityFormInput | null;
  sourceId: string | null;
}

export interface ImportPreview {
  fileProblems: CsvProblem[];
  missingColumns: string[];
  unknownColumns: string[];
  duplicateColumns: string[];
  delimiter: string;
  rows: ImportRow[];
  summary: { total: number; ok: number; warning: number; error: number; duplicate: number; possibleDuplicate: number; importable: number };
}

const cell = (cells: string[], headers: string[], name: string): string => {
  const i = headers.indexOf(name);
  return i >= 0 ? (cells[i] ?? "").trim() : "";
};

const YES = new Set(["yes", "y", "true", "1", "да", "bəli", "beli", "həə"]);

/** Dates people type: 2030-03-31, 2030-03-31 18:00, 31.03.2030, 31.03.2030 18:00 → the form's "YYYY-MM-DDTHH:mm" (date only = end of that day). */
export function toFormDateTime(raw: string, dateOnlyTime = "23:59"): string {
  const v = raw.trim();
  if (!v) return "";
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4] ? m[4].padStart(2, "0") : dateOnlyTime.slice(0, 2)}:${m[5] ?? dateOnlyTime.slice(3)}`;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(v);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}T${m[4] ? m[4].padStart(2, "0") : dateOnlyTime.slice(0, 2)}:${m[5] ?? dateOnlyTime.slice(3)}`;
  return v; // left as typed: the form validator reports it as an invalid date
}

const issue = (severity: ImportIssue["severity"], code: string, column?: string, params?: ImportIssue["params"]): ImportIssue => ({ severity, kind: "import", code, ...(column ? { column } : {}), ...(params ? { params } : {}) });

const THREE_YEARS_MS = 3 * 365 * 86_400_000;

function resolveOrganization(value: string, organizations: readonly ImportOrganization[]): ImportOrganization | null {
  const folded = foldText(value.trim());
  if (!folded) return null;
  return organizations.find((o) => o.slug === value.trim().toLowerCase()) ?? organizations.find((o) => foldText(o.name) === folded) ?? null;
}

function resolveSource(sourceCell: string, officialUrl: string | null, sources: readonly ImportSourceRef[]): { source: ImportSourceRef | null; unknown: boolean } {
  const wanted = sourceCell.trim();
  if (wanted) {
    const normalized = normalizeUrl(wanted);
    const found = sources.find((s) => (normalized && normalizeUrl(s.websiteUrl) === normalized) || foldText(s.organizationName) === foldText(wanted));
    return { source: found ?? null, unknown: !found };
  }
  // No source named: link to a registered, active source with the same host (never guessed from anything weaker).
  const host = officialUrl ? parseHost(officialUrl)?.hostname.toLowerCase().replace(/^www\./, "") : undefined;
  const match = host ? sources.filter((s) => s.isActive).find((s) => parseHost(s.websiteUrl)?.hostname.toLowerCase().replace(/^www\./, "") === host) : undefined;
  return { source: match ?? null, unknown: false };
}

export function validateImport(csvText: string, context: ImportContext): ImportPreview {
  const now = context.now ?? new Date();
  const csv = parseCsv(csvText);
  const blank = (): ImportPreview => ({ fileProblems: csv.problems, missingColumns: [], unknownColumns: [], duplicateColumns: [], delimiter: csv.delimiter, rows: [], summary: { total: 0, ok: 0, warning: 0, error: 0, duplicate: 0, possibleDuplicate: 0, importable: 0 } });
  const fatal = csv.problems.some((p) => p === "empty" || p === "too_large" || p === "binary" || p === "unclosed_quote");
  if (fatal || csv.headers.length === 0) return blank();

  const headers = csv.headers;
  const missingColumns = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  const hasTitle = IMPORT_LANGUAGES.some((l) => headers.includes(`title_${l}`));
  if (!hasTitle) missingColumns.push("title_az" as never);
  const unknownColumns = headers.filter((h) => h !== "" && !ALL_COLUMNS.includes(h));
  const duplicateColumns = headers.filter((h, i) => h !== "" && headers.indexOf(h) !== i);
  const preview: ImportPreview = { ...blank(), missingColumns, unknownColumns, duplicateColumns };
  if (missingColumns.length > 0 || duplicateColumns.length > 0) return preview;

  const taken = new Set(context.index.map((e) => e.slug));
  const batchKeys = new Map<string, number>(); // normalised official URL / slug → first line
  const batchEntries: DuplicateIndexEntry[] = [];

  for (const { line, cells } of csv.rows) {
    const issues: ImportIssue[] = [];
    const get = (name: string) => cell(cells, headers, name);
    const titleOf = (l: string) => get(`title_${l}`);
    const original = get("original_language").toLowerCase();
    const orgCell = get("organization");
    const title = titleOf(original) || IMPORT_LANGUAGES.map(titleOf).find(Boolean) || "";

    if (cells.length > headers.length && cells.slice(headers.length).some((c) => c.trim() !== "")) issues.push(issue("error", "too_many_cells"));
    if (/^\s*EXAMPLE\b/i.test(title)) issues.push(issue("error", "example_row", "title_en"));

    // organization
    const org = resolveOrganization(orgCell, context.organizations);
    if (!orgCell) issues.push(issue("error", "organization_required", "organization"));
    else if (!org) issues.push(issue("error", "organization_not_found", "organization", { value: orgCell }));

    if (!IMPORT_LANGUAGES.includes(original as never)) issues.push(issue("error", "original_language_unsupported", "original_language", { value: original }));

    // build the SAME form the admin types in, so the one validator decides
    const form = new FormData();
    const set = (name: string, value: string) => form.set(name, value);
    set("organizationId", org?.id ?? "unresolved-organization");
    set("opportunityType", get("opportunity_type").toLowerCase());
    set("otherTypeLabel", get("other_type_label"));
    set("locationType", get("location_type").toLowerCase());
    set("country", get("country"));
    set("cityId", get("city_id").toLowerCase());
    set("cityText", get("city_text"));
    for (const v of get("education_levels").split("|").map((s) => s.trim().toLowerCase()).filter(Boolean)) form.append("educationLevels", v);
    for (const v of get("eligible_fields").split("|").map((s) => s.trim().toLowerCase()).filter(Boolean)) form.append("eligibleFields", v);
    set("eligibleCountries", get("eligible_countries").split("|").map((s) => s.trim()).filter(Boolean).join(","));
    set("fundingType", get("funding_type").toLowerCase() || "not_specified");
    set("fundingAmount", get("funding_amount"));
    set("fundingCurrency", get("funding_currency"));
    set("fundingPeriod", get("funding_period").toLowerCase());
    set("fundingPercent", get("funding_percent"));
    set("feeAmount", get("fee_amount"));
    set("feeCurrency", get("fee_currency"));
    set("applicationUrl", get("application_url"));
    set("officialSourceUrl", get("official_source_url"));
    set("deadlineType", get("deadline_type").toLowerCase() || "unknown");
    set("deadline", toFormDateTime(get("deadline")));
    set("startDate", toFormDateTime(get("start_date"), "00:00"));
    set("deadlineTimezone", get("deadline_timezone") || "Asia/Baku");
    set("originalLanguage", IMPORT_LANGUAGES.includes(original as never) ? original : "az");
    set("slug", get("slug").toLowerCase());
    const reviewed = YES.has(get("translations_reviewed").toLowerCase());
    for (const l of IMPORT_LANGUAGES) {
      for (const f of TEXT_FIELDS) set(`t_${l}_${f}`, get(`${f}_${l}`));
      // Translations of unknown origin are imported as MACHINE DRAFTS: hidden from the public until an admin approves them.
      if (l !== original) set(`t_${l}_status`, reviewed ? "human" : "machine_draft");
    }

    const parsed = parseOpportunityForm(form);
    if (!parsed.ok) {
      for (const [field, error] of Object.entries(parsed.errors)) {
        if (field === "organizationId" && !org) continue; // already reported with a clearer message
        issues.push({ severity: "error", kind: "validation", code: error.code, column: fieldToColumn(field), ...(error.params ? { params: error.params } : {}) });
      }
    }

    // data-quality rules on top of the form's own validation
    const officialRaw = get("official_source_url");
    if (!officialRaw) issues.push(issue("error", "official_source_required", "official_source_url"));
    else {
      const knownHosts = context.sources.filter((s) => s.isActive).flatMap((s) => parseHost(s.websiteUrl)?.hostname ?? []);
      for (const problem of checkOfficialUrl(officialRaw, knownHosts)) {
        // The form already reports malformed / non-https URLs; add the finer problems.
        const isError = URL_ERRORS.includes(problem);
        if (problem === "not_https" || problem === "invalid") continue;
        issues.push(issue(isError ? "error" : "warning", `url_${problem}`, "official_source_url"));
      }
    }
    const applicationRaw = get("application_url");
    if (applicationRaw) for (const problem of checkOfficialUrl(applicationRaw)) if (URL_ERRORS.includes(problem) && problem !== "not_https" && problem !== "invalid") issues.push(issue("error", `url_${problem}`, "application_url"));

    let input: OpportunityFormInput | null = null;
    let sourceId: string | null = null;
    let duplicates: ImportRow["duplicates"] = [];

    if (parsed.ok) {
      input = { ...parsed.value };
      // deadline validation
      const deadline = input.applicationDeadline ? new Date(input.applicationDeadline) : null;
      if (deadline && deadline.getTime() < now.getTime()) issues.push(issue("warning", "deadline_in_past", "deadline"));
      if (deadline && deadline.getTime() > now.getTime() + THREE_YEARS_MS) issues.push(issue("warning", "deadline_far_future", "deadline"));
      if (input.deadlineType === "unknown") issues.push(issue("warning", "deadline_unknown", "deadline_type"));
      // translations: report what is missing, never fill it
      const originalText = input.translations.find((t) => t.status === "original");
      if (!originalText?.shortDescription) issues.push(issue("warning", "short_description_missing", `short_${original}`));
      for (const l of IMPORT_LANGUAGES) if (l !== original && !input.translations.some((t) => t.language === l)) issues.push(issue("warning", "translation_missing", `title_${l}`, { language: l }));
      if (input.translations.some((t) => t.status === "machine_draft")) issues.push(issue("warning", "translations_unreviewed", "translations_reviewed"));
      // source
      const resolved = resolveSource(get("source"), input.officialSourceUrl, context.sources);
      sourceId = resolved.source?.id ?? null;
      if (resolved.unknown) issues.push(issue("warning", "source_unknown", "source", { value: get("source") }));
      else if (!resolved.source) issues.push(issue("warning", "source_unlinked", "source"));
      else if (!resolved.source.isActive) issues.push(issue("warning", "source_inactive", "source"));

      // duplicates: against the catalogue and against earlier rows of this file
      const titles = input.translations.map((t) => t.title);
      const candidate = { slug: input.slug, organizationId: input.organizationId, officialSourceUrl: input.officialSourceUrl, applicationDeadline: input.applicationDeadline, titles };
      const explicitSlug = get("slug") !== "";
      // A GENERATED slug is made unique below, so it can never count as a duplicate; an explicit one can.
      duplicates = findDuplicates(candidate, [...context.index, ...batchEntries], { ignoreSlug: !explicitSlug });
      for (const d of duplicates) {
        const inFile = batchKeys.get(d.id);
        if (inFile !== undefined) (d as ImportRow["duplicates"][number]).inFileLine = inFile;
      }
      if (!explicitSlug) input.slug = uniqueSlug(input.slug, new Set([...taken, ...batchEntries.map((e) => e.slug)]));
      else if (!isValidSlug(input.slug)) issues.push({ severity: "error", kind: "validation", code: "invalid_slug", column: "slug" });
    }

    const hasError = issues.some((i) => i.severity === "error");
    const exact = duplicates.some((d) => d.level === "exact");
    const possible = !exact && duplicates.length > 0;
    const status: ImportRowStatus = hasError ? "error" : exact ? "duplicate" : possible ? "possible_duplicate" : issues.length > 0 ? "warning" : "ok";

    if (input && !hasError) {
      const id = `row-${line}`;
      batchEntries.push({ id, slug: input.slug, organizationId: input.organizationId, officialSourceUrl: input.officialSourceUrl, applicationDeadline: input.applicationDeadline, status: "draft", titles: input.translations.map((t) => t.title) });
      batchKeys.set(id, line);
    }
    preview.rows.push({ line, status, title, organization: org?.name ?? orgCell, issues, duplicates, input: hasError ? null : input, sourceId });
  }

  const count = (s: ImportRowStatus) => preview.rows.filter((r) => r.status === s).length;
  preview.summary = {
    total: preview.rows.length, ok: count("ok"), warning: count("warning"), error: count("error"), duplicate: count("duplicate"), possibleDuplicate: count("possible_duplicate"),
    importable: count("ok") + count("warning"),
  };
  return preview;
}

export { BASE_COLUMNS };
