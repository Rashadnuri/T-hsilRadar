import type { Metadata } from "next";
import { ExternalLink, Languages } from "lucide-react";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Container } from "@/components/layout/container";
import { DemoNotice } from "@/components/shared/demo-notice";
import { Badge } from "@/components/ui/badge";
import { ApplyAction } from "@/features/opportunities/apply-action";
import { MatchPanel } from "@/features/matching/match-panel";
import { PlanPanel } from "@/features/plan/plan-panel";
import { BackToCatalogue } from "@/features/opportunities/catalogue-memory";
import { opportunityTypeIcons } from "@/features/opportunities/type-icons";
import { getLanguageName } from "@/i18n/content-language";
import { routing } from "@/i18n/routing";
import { formatDateTimeInZone, regionName } from "@/lib/format";
import { buildOpportunityMetadata } from "@/lib/seo/opportunity-metadata";
import { getApplicationState } from "@/lib/opportunities/deadline";
import { formatFundingAmount, formatParticipationFee, fundingPeriodKey } from "@/lib/opportunities/funding";
import { deriveMarketScope, getLocationParts } from "@/lib/opportunities/location";
import { getEffectiveVerificationStatus } from "@/lib/opportunities/status";
import { getAvailableLanguages, resolveContent } from "@/lib/opportunities/translations";
import { getOpportunityBySlug, listAllSlugs } from "@/services/opportunities";
import type { ResolvedField } from "@/types/translation";

// Deadline state is derived at render time; refresh regularly so it cannot go stale in the cache.
export const revalidate = 600;

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateStaticParams() {
  const slugs = await listAllSlugs();
  return routing.locales.flatMap((locale) => slugs.map((slug) => ({ locale, slug })));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const o = await getOpportunityBySlug(slug);
  if (!o) return {};
  return buildOpportunityMetadata(o, locale);
}

export default async function OpportunityPage({ params }: PageProps) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const o = await getOpportunityBySlug(slug);
  if (!o) notFound();

  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const content = resolveContent(o, locale);
  const state = getApplicationState(o);
  const verification = getEffectiveVerificationStatus(o);
  const TypeIcon = opportunityTypeIcons[o.opportunityType];
  const expired = state === "expired";

  const { city, country } = getLocationParts(o, locale);
  const place = [city, country].filter(Boolean).join(", ");
  const amount = formatFundingAmount(o, locale);
  const periodKey = fundingPeriodKey(o.fundingPeriod);
  const fee = formatParticipationFee(o, locale);
  const dateTime = (iso: string) => formatDateTimeInZone(iso, locale, o.deadlineTimezone);

  const listOrNotSpecified = (values: string[]) => (values.length ? format.list(values, { type: "conjunction" }) : t("detail.notSpecified"));
  const facts: [string, string][] = [
    [t("detail.organization"), `${o.organization.name} · ${t(`orgKinds.${o.organization.kind}`)}`],
    [t("detail.market"), t(`scope.${deriveMarketScope(o)}`)],
    [t("detail.location"), `${t(`locationType.${o.locationType}`)}${place ? ` · ${place}` : ""}`],
    [t("detail.funding"), [t(`funding.${o.fundingType}`), amount && `${amount}${periodKey ? ` ${t(`funding.period.${periodKey}`)}` : ""}`, o.fundingPercent !== null && format.number(o.fundingPercent / 100, { style: "percent" })].filter(Boolean).join(" · ")],
    ...(fee ? ([[t("detail.participationFee"), fee]] as [string, string][]) : []),
    [t("detail.levels"), listOrNotSpecified(o.educationLevels.map((l) => t(`level.${l}`)))],
    [t("detail.fields"), listOrNotSpecified(o.eligibleFields.map((f) => t(`fields.${f}`)))],
    [t("detail.eligibleCountries"), o.eligibleCountries ? format.list(o.eligibleCountries.map((c) => regionName(c, locale)), { type: "conjunction" }) : t("detail.notSpecified")],
    ...(o.applicationStartDate ? ([[t("detail.startDate"), dateTime(o.applicationStartDate)]] as [string, string][]) : []),
    [t("detail.deadline"), o.applicationDeadline && o.deadlineType === "fixed" ? dateTime(o.applicationDeadline) : t(o.deadlineType === "rolling" ? "lifecycle.rolling" : "lifecycle.unknown")],
    [t("detail.verification"), o.isDemo ? t("verification.demo") : verification === "verified" && o.lastVerifiedAt ? t("verification.verifiedOn", { date: format.dateTime(new Date(o.lastVerifiedAt), "long") }) : t(`verification.${verification}`)],
    [t("detail.languages"), format.list(getAvailableLanguages(o).map(getLanguageName), { type: "conjunction" })],
  ];

  /** A text section in its own language, labelled when it is not in the page language. */
  const sections: { key: "description" | "eligibility" | "requirements" | "benefits"; field: ResolvedField | null }[] = [
    { key: "description", field: content.description },
    { key: "eligibility", field: content.eligibility },
    { key: "requirements", field: content.requirements },
    { key: "benefits", field: content.benefits },
  ];

  return (
    <Container className="py-8 sm:py-12">
      <BackToCatalogue />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <article className="min-w-0 space-y-6">
          <div className="flex flex-wrap gap-2">
            <Badge>
              <TypeIcon aria-hidden="true" />
              {o.opportunityType === "other" && o.otherTypeLabel ? o.otherTypeLabel : t(`opportunityTypes.${o.opportunityType}`)}
            </Badge>
            {o.isDemo && <Badge variant="demo">{t("demo.badge")}</Badge>}
            {state === "expired" && <Badge variant="muted">{t("lifecycle.expired")}</Badge>}
            {state === "closing_soon" && <Badge variant="warning">{t("lifecycle.closingSoon")}</Badge>}
            {state === "open" && <Badge variant="success">{t("lifecycle.open")}</Badge>}
            {state === "rolling" && <Badge variant="success">{t("lifecycle.rolling")}</Badge>}
            {state === "upcoming" && <Badge variant="outline">{t("lifecycle.upcoming")}</Badge>}
            {!o.isDemo && verification === "verified" && o.lastVerifiedAt && (
              <Badge variant="success">{t("verification.verifiedOn", { date: format.dateTime(new Date(o.lastVerifiedAt), "long") })}</Badge>
            )}
          </div>

          <h1 lang={content.title.language} className={`text-3xl font-bold sm:text-4xl ${expired ? "text-muted-foreground" : ""}`}>
            {content.title.value}
          </h1>

          <div className="space-y-3 lg:hidden">
            <ApplyAction record={o} state={state} locale={locale} />
            <PlanPanel opportunityId={o.id} title={content.title.value} slug={o.slug} />
          </div>

          {o.isDemo && <DemoNotice />}
          {state === "expired" && (
            <p role="alert" className="rounded-xl border border-border bg-muted px-4 py-3 text-sm font-medium">
              {t("detail.expiredBanner")}
            </p>
          )}
          {content.languagesUsed.some((l) => l !== locale) && (
            <p role="note" className="flex items-start gap-2 rounded-xl border bg-secondary px-4 py-3 text-sm text-primary">
              <Languages className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {t("translation.someShownIn", {
                languages: format.list(content.languagesUsed.filter((l) => l !== locale).map(getLanguageName), { type: "conjunction" }),
              })}
            </p>
          )}
          {content.hasMachineTranslation && (
            <p role="note" className="rounded-xl border bg-muted px-4 py-3 text-sm">
              {t("translation.machine")}
            </p>
          )}
          {content.hasOutdatedTranslation && (
            <p role="note" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              {t("translation.outdated")}
            </p>
          )}

          {content.shortDescription && (
            <p lang={content.shortDescription.language} className="text-lg text-foreground/85">
              {content.shortDescription.value}
            </p>
          )}

          {sections.map(({ key, field }) =>
            field ? (
              <section key={key} aria-labelledby={`${key}-heading`}>
                <h2 id={`${key}-heading`} className="text-xl font-semibold">
                  {t(`detail.sections.${key}`)}
                </h2>
                {field.isFallback && (
                  <p className="mt-1 text-xs text-muted-foreground">{t("translation.sectionShownIn", { language: getLanguageName(field.language) })}</p>
                )}
                <p lang={field.language} className="mt-2 whitespace-pre-line text-foreground/85">
                  {field.value}
                </p>
              </section>
            ) : null,
          )}

          <section aria-labelledby="source-heading" className="rounded-2xl border bg-surface p-5">
            <h2 id="source-heading" className="flex items-center gap-2 text-lg font-semibold">
              <ExternalLink className="size-4 text-accent" aria-hidden="true" />
              {t("detail.sourceTitle")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{o.isDemo ? t("detail.sourceDemo") : t("detail.sourceReal")}</p>
            {o.officialSourceUrl && (
              <>
                <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("detail.sourceUrl")}</p>
                <a href={o.officialSourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-11 items-center gap-2 break-all text-sm font-semibold text-accent hover:underline">
                  {o.officialSourceUrl}
                  <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                </a>
              </>
            )}
          </section>

          <MatchPanel opportunityId={o.id} slug={o.slug} />
        </article>

        <aside aria-labelledby="facts-heading" className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="hidden space-y-3 lg:block">
            <ApplyAction record={o} state={state} locale={locale} />
            <PlanPanel opportunityId={o.id} title={content.title.value} slug={o.slug} />
          </div>
          <div className="rounded-2xl border bg-card p-5 shadow-card">
            <h2 id="facts-heading" className="mb-4 text-lg font-semibold">
              {t("detail.factsTitle")}
            </h2>
            <dl className="space-y-4">
              {facts.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5 font-medium text-primary">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </aside>
      </div>
    </Container>
  );
}
