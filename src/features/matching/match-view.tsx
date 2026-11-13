import { AlertCircle, CheckCircle2, CircleHelp, ShieldCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { criterionMessageKey, criterionValues, type DescribeTools } from "@/lib/matching/describe";
import type { Criterion, MatchBand, MatchResult } from "@/lib/matching/types";
import { cn } from "@/lib/utils";

const BAND_STYLE: Record<MatchBand, string> = {
  strong: "bg-emerald-600",
  good: "bg-emerald-500",
  partial: "bg-amber-500",
  low: "bg-slate-400",
  insufficient: "bg-slate-400",
  ineligible: "bg-red-600",
  closed: "bg-slate-500",
};

/** Localized display helpers (level/field/type names from the message files, countries and languages from CLDR). */
function useDescribeTools(): DescribeTools {
  const locale = useLocale();
  const t = useTranslations();
  const regions = new Intl.DisplayNames([locale], { type: "region" });
  const languages = new Intl.DisplayNames([locale], { type: "language" });
  const list = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
  const safe = (fn: () => string | undefined, fallback: string) => {
    try {
      return fn() ?? fallback;
    } catch {
      return fallback;
    }
  };
  return {
    level: (code) => t(`level.${code}` as never),
    field: (code) => t(`fields.${code}` as never),
    type: (code) => t(`opportunityTypes.${code}` as never),
    country: (code) => safe(() => regions.of(code), code),
    language: (code) => safe(() => languages.of(code), code),
    list: (items) => (items.length ? list.format(items) : ""),
  };
}

export function ScoreMeter({ match }: { match: Pick<MatchResult, "score" | "band"> }) {
  const t = useTranslations("matching");
  return (
    <div className="flex items-center gap-4">
      <div role="img" aria-label={`${t("score.label")}: ${t("score.outOf", { score: match.score })}`} className="min-w-0 flex-1">
        <div className="h-2.5 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full", BAND_STYLE[match.band])} style={{ width: `${match.score}%` }} />
        </div>
      </div>
      <p className="shrink-0 text-right">
        <span className="text-2xl font-bold text-primary" data-testid="match-score">
          {match.score}
        </span>
        <span className="text-sm text-muted-foreground">{" / 100"}</span>
      </p>
    </div>
  );
}

function CriterionItem({ criterion }: { criterion: Criterion }) {
  const t = useTranslations("matching");
  const tools = useDescribeTools();
  const key = criterionMessageKey(criterion);
  const text = t(`criteria.${key}` as never, criterionValues(criterion, tools) as never);
  const Icon = criterion.status === "unmet" ? AlertCircle : criterion.status === "unknown" ? CircleHelp : CheckCircle2;
  return (
    <li className="flex gap-2.5 text-sm" data-criterion={criterion.id} data-status={criterion.status}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", criterion.status === "unmet" ? "text-destructive" : criterion.status === "unknown" ? "text-muted-foreground" : "text-emerald-600")} aria-hidden="true" />
      <span className="min-w-0">
        <span className="font-medium text-primary">{t(`criterionName.${criterion.id}` as never)}</span>
        {criterion.mandatory && <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">{t("mandatory")}</span>}
        <span className="block text-foreground/80">{text}</span>
      </span>
    </li>
  );
}

function Section({ title, items, testId }: { title: string; items: Criterion[]; testId: string }) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title} data-testid={testId}>
      <h4 className="mb-2 text-sm font-semibold text-primary">{title}</h4>
      <ul className="space-y-2.5">
        {items.map((c) => (
          <CriterionItem key={c.id} criterion={c} />
        ))}
      </ul>
    </section>
  );
}

/** The explanation of one match: score, band, eligibility, and every criterion grouped into reasons / missing / unchecked. */
export function MatchView({ match }: { match: MatchResult }) {
  const t = useTranslations("matching");
  return (
    <div className="space-y-5" data-testid="match-view" data-band={match.band} data-eligibility={match.eligibility}>
      <div>
        <p className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="font-semibold text-primary" data-testid="match-band">
            {t(`band.${match.band}` as never)}
          </span>
          <span className="text-muted-foreground">{t(`eligibility.${match.eligibility}` as never)}</span>
        </p>
        <ScoreMeter match={match} />
        <p className="mt-2 text-xs text-muted-foreground">{t("completeness", { percent: match.completeness })}</p>
      </div>
      <Section title={t("sections.missing")} items={match.missing} testId="match-missing" />
      <Section title={t("sections.reasons")} items={match.reasons} testId="match-reasons" />
      <Section title={t("sections.unknown")} items={match.unknown} testId="match-unknown" />
      {match.needsManualReview && <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{t("manual")}</p>}
      <p className="flex items-start gap-2 text-xs text-muted-foreground" data-testid="match-disclaimer">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
        {t("disclaimer")}
      </p>
    </div>
  );
}
