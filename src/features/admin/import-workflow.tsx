"use client";

import { useRef, useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, Download, FileUp, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { ImportCommitResult, ImportPreviewView } from "./import-handlers";
import { importCommitAction, importPreviewAction } from "./import-actions";

const MAX_BYTES = 1_000_000;
const STATUS_STYLE: Record<string, string> = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-900",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  error: "border-red-300 bg-red-50 text-red-900",
  duplicate: "border-slate-300 bg-muted text-muted-foreground",
  possible_duplicate: "border-amber-300 bg-amber-50 text-amber-900",
};

type PreviewRow = ImportPreviewView["rows"][number];

function Issue({ issue }: { issue: PreviewRow["issues"][number] }) {
  const tImport = useTranslations("admin.import");
  const tIssue = useTranslations("admin.import.issues");
  const tValidation = useTranslations("validation");
  const params = Object.fromEntries(Object.entries(issue.params ?? {}).map(([k, v]) => [k, k === "language" ? String(v).toUpperCase() : v])) as Record<string, string | number>;
  const message = issue.kind === "validation" ? tValidation(issue.code as never, params as never) : tIssue(issue.code as never, params as never);
  const Icon = issue.severity === "error" ? AlertCircle : TriangleAlert;
  return (
    <li className="flex gap-2 text-sm" data-issue={issue.code} data-severity={issue.severity}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", issue.severity === "error" ? "text-destructive" : "text-amber-600")} aria-hidden="true" />
      <span className="min-w-0">
        <span className="sr-only">{`${issue.severity === "error" ? tImport("preview.errorPrefix") : tImport("preview.warningPrefix")}: `}</span>
        {issue.column && <code className="mr-1.5 rounded bg-muted px-1 py-0.5 text-xs">{issue.column}</code>}
        {message}
      </span>
    </li>
  );
}

export function ImportWorkflow() {
  const t = useTranslations("admin.import");
  const tUp = useTranslations("admin.import.upload");
  const tPrev = useTranslations("admin.import.preview");
  const tDup = useTranslations("admin.import.duplicate");
  const tRes = useTranslations("admin.import.results");
  const tProblems = useTranslations("admin.import.fileProblems");
  const tCols = useTranslations("admin.import.columns");
  const tErr = useTranslations("admin.errors");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [includePossible, setIncludePossible] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewView | null>(null);
  const [result, setResult] = useState<ImportCommitResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [checking, startChecking] = useTransition();
  const [importing, startImporting] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File | undefined) {
    setMessage(null);
    setPreview(null);
    setResult(null);
    if (!file) return;
    if (file.size > MAX_BYTES) return setMessage(tUp("tooLarge"));
    setFileName(file.name);
    setCsv(await file.text());
  }

  const clear = () => {
    setCsv("");
    setFileName("");
    setPreview(null);
    setResult(null);
    setMessage(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const check = () => {
    if (!csv.trim()) return setMessage(tUp("empty"));
    setMessage(null);
    setResult(null);
    startChecking(async () => {
      const r = await importPreviewAction(csv);
      if (r.ok) setPreview(r.preview);
      else setMessage(tErr(r.code as never));
    });
  };

  const importable = preview ? preview.summary.importable + (includePossible ? preview.summary.possibleDuplicate : 0) : 0;
  const commit = () =>
    startImporting(async () => {
      const r = await importCommitAction(csv, includePossible);
      if (r.ok) {
        setResult(r);
        setPreview(null);
      } else setMessage(r.code === "invalid" ? tErr("invalid_file") : tErr(r.code as never));
    });

  const tiles: [string, number][] = preview
    ? [
        ["total", preview.summary.total],
        ["importable", preview.summary.importable],
        ["errors", preview.summary.error],
        ["duplicates", preview.summary.duplicate],
        ["possible", preview.summary.possibleDuplicate],
      ]
    : [];

  return (
    <div className="space-y-8" data-testid="import-workflow">
      <section className="space-y-3 rounded-2xl border bg-card p-5 shadow-soft sm:p-6" aria-labelledby="step-template">
        <h2 id="step-template" className="text-lg font-semibold">
          {t("steps.template")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("template.help")}</p>
        <Button asChild variant="outline">
          <a href="/api/admin/import-template" download data-testid="template-link">
            <Download aria-hidden="true" />
            {t("template.download")}
          </a>
        </Button>
        <div className="rounded-xl bg-secondary p-4">
          <h3 className="mb-2 text-sm font-semibold text-primary">{t("rules.title")}</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground/80">
            {(["official", "draft", "nothing", "translations", "active"] as const).map((k) => (
              <li key={k}>{t(`rules.${k}`)}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-soft sm:p-6" aria-labelledby="step-upload">
        <h2 id="step-upload" className="text-lg font-semibold">
          {t("steps.upload")}
        </h2>
        <div>
          <Label htmlFor="csv-file">{tUp("file")}</Label>
          <input ref={inputRef} id="csv-file" type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void onFile(e.target.files?.[0])} className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:bg-background file:px-3 file:py-2 file:text-sm file:font-semibold" data-testid="csv-file" />
          {fileName && <p className="mt-1 text-xs text-muted-foreground">{fileName}</p>}
        </div>
        <div>
          <Label htmlFor="csv-text">{tUp("paste")}</Label>
          <Textarea id="csv-text" rows={5} value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); setResult(null); }} className="font-mono text-xs" data-testid="csv-text" spellCheck={false} />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={check} disabled={checking || importing} data-testid="check-file">
            <FileUp aria-hidden="true" />
            {checking ? tUp("checking") : tUp("check")}
          </Button>
          <Button type="button" variant="outline" onClick={clear} disabled={checking || importing}>
            {tUp("clear")}
          </Button>
        </div>
        {message && (
          <p role="alert" className="text-sm text-destructive" data-testid="import-message">
            {message}
          </p>
        )}
      </section>

      {preview && (
        <section className="space-y-5 rounded-2xl border bg-card p-5 shadow-soft sm:p-6" aria-labelledby="step-review" data-testid="import-preview">
          <h2 id="step-review" className="text-lg font-semibold">
            {t("steps.review")}
          </h2>

          {preview.fileProblems.length > 0 && (
            <ul className="space-y-1 text-sm text-destructive" data-testid="file-problems">
              {preview.fileProblems.map((p) => (
                <li key={p} data-problem={p}>
                  {tProblems(p as never)}
                </li>
              ))}
            </ul>
          )}
          {preview.missingColumns.length > 0 && (
            <p className="text-sm text-destructive" data-testid="missing-columns">
              {tCols("missing", { columns: preview.missingColumns.join(", ") })}
            </p>
          )}
          {preview.duplicateColumns.length > 0 && <p className="text-sm text-destructive">{tCols("duplicate", { columns: preview.duplicateColumns.join(", ") })}</p>}
          {preview.unknownColumns.length > 0 && <p className="text-sm text-amber-800">{tCols("unknown", { columns: preview.unknownColumns.join(", ") })}</p>}

          {preview.rows.length > 0 && (
            <>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {tiles.map(([key, value]) => (
                  <div key={key} className="rounded-xl border bg-background p-3">
                    <dt className="text-xs text-muted-foreground">{tPrev(`summary.${key}` as never)}</dt>
                    <dd className="text-xl font-bold text-primary" data-testid={`summary-${key}`}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>

              <ul className="space-y-3" data-testid="import-rows">
                {preview.rows.map((row) => (
                  <li key={row.line} className="rounded-xl border p-4" data-testid="import-row" data-status={row.status} data-line={row.line}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">{`${tPrev("columns.line")} ${row.line}`}</span>
                      <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold", STATUS_STYLE[row.status])}>{tPrev(`statuses.${row.status}` as never)}</span>
                      {row.languages.length > 0 && <span className="text-xs text-muted-foreground">{tPrev("languages", { languages: row.languages.map((l) => l.toUpperCase()).join(", ") })}</span>}
                    </div>
                    <p className="mt-1 font-semibold text-primary">{row.title || "—"}</p>
                    {row.organization && <p className="text-sm text-muted-foreground">{row.organization}</p>}
                    {row.duplicates.length > 0 && (
                      <ul className="mt-2 space-y-1 text-sm" data-testid="duplicate-info">
                        {row.duplicates.slice(0, 3).map((d) => (
                          <li key={d.id} className="text-amber-900">
                            {(d.level === "exact" ? tDup("of", { slug: d.slug, reason: tDup(`reasons.${d.reason}` as never) }) : tDup("possibleOf", { slug: d.slug, reason: tDup(`reasons.${d.reason}` as never) }))}
                            {d.inFileLine ? ` — ${tDup("inFile", { line: d.inFileLine })}` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                    {row.issues.length > 0 ? (
                      <ul className="mt-2 space-y-1.5">
                        {row.issues.map((issue, i) => (
                          <Issue key={`${issue.code}-${issue.column}-${i}`} issue={issue} />
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 flex items-center gap-2 text-sm text-emerald-800">
                        <CheckCircle2 className="size-4" aria-hidden="true" />
                        {tPrev("noProblems")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>

              <div className="space-y-3 border-t pt-5">
                <h3 className="text-base font-semibold">{t("steps.import")}</h3>
                <p className="text-sm text-muted-foreground">{tPrev("neverPublish")}</p>
                {preview.summary.possibleDuplicate > 0 && (
                  <Label className="mb-0 flex min-h-10 cursor-pointer items-center gap-3 font-normal">
                    <input type="checkbox" checked={includePossible} onChange={(e) => setIncludePossible(e.target.checked)} className="size-4 accent-[var(--accent)]" data-testid="include-possible" />
                    {tPrev("includePossible")}
                  </Label>
                )}
                {importable === 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="nothing-to-import">
                    {tPrev("nothingToImport")}
                  </p>
                ) : (
                  <Button type="button" size="lg" onClick={commit} disabled={importing} data-testid="import-button">
                    {importing ? tPrev("importing") : tPrev("importButton", { count: importable })}
                  </Button>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {result && (
        <section className="space-y-4 rounded-2xl border border-accent/40 bg-card p-5 shadow-soft sm:p-6" aria-labelledby="import-result" data-testid="import-result">
          <h2 id="import-result" className="text-lg font-semibold">
            {tRes("title")}
          </h2>
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm font-medium text-primary">
            <li data-testid="result-created">{tRes("created", { count: result.created })}</li>
            <li data-testid="result-skipped">{tRes("skipped", { count: result.skipped })}</li>
            <li data-testid="result-failed">{tRes("failed", { count: result.failed })}</li>
          </ul>
          <p className="text-sm text-muted-foreground" data-testid="result-batch">
            {tRes("batch", { batch: result.batch })}
          </p>
          <ul className="space-y-1 text-sm">
            {result.results.map((r) => (
              <li key={r.line} data-outcome={r.outcome}>
                {`${r.line} · ${r.title || "—"} · ${tRes(`outcome.${r.outcome}` as never)}${r.reason ? ` (${tRes(`reasons.${r.reason}` as never)})` : ""}`}
              </li>
            ))}
          </ul>
          {result.created > 0 && (
            <Button asChild>
              <Link href={{ pathname: "/admin/opportunities", query: { batch: result.batch } }} data-testid="review-batch">
                {tRes("review")}
              </Link>
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
