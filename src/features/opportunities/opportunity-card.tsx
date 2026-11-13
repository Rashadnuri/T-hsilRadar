import { BadgeCheck, Building2, CalendarClock, Languages, MapPin, Monitor, Wallet } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getLanguageBadge, getLanguageName } from "@/i18n/content-language";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { daysUntilDeadline, getApplicationState } from "@/lib/opportunities/deadline";
import { formatFundingAmount } from "@/lib/opportunities/funding";
import { deriveMarketScope, getLocationParts } from "@/lib/opportunities/location";
import { getEffectiveVerificationStatus } from "@/lib/opportunities/status";
import { getAvailableLanguages, resolveContent } from "@/lib/opportunities/translations";
import type { OpportunityRecord } from "@/types/opportunity";
import { SaveButton } from "@/features/plan/save-button";
import { opportunityTypeIcons } from "./type-icons";

interface OpportunityCardProps {
  opportunity: OpportunityRecord;
  locale: Locale;
}

export async function OpportunityCard({ opportunity: o, locale }: OpportunityCardProps) {
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const content = resolveContent(o, locale);
  const state = getApplicationState(o);
  const expired = state === "expired";
  const verified = !o.isDemo && getEffectiveVerificationStatus(o) === "verified";
  const TypeIcon = opportunityTypeIcons[o.opportunityType];

  const { city, country } = getLocationParts(o, locale);
  const place = [city, country].filter(Boolean).join(", ");
  const amount = formatFundingAmount(o, locale);
  const days = daysUntilDeadline(o);
  const deadline =
    o.applicationDeadline && o.deadlineType === "fixed"
      ? format.dateTime(new Date(o.applicationDeadline), { dateStyle: "long", timeZone: o.deadlineTimezone })
      : state === "rolling"
        ? t("lifecycle.rolling")
        : t("lifecycle.unknown");

  // The card shows only title + short description, so only their languages matter here.
  const shownFallbacks = [content.title, content.shortDescription].filter((f) => f?.isFallback);
  const fallbackLanguage = shownFallbacks[0]?.language;
  const availableLanguages = getAvailableLanguages(o);
  const languageNames = availableLanguages.map(getLanguageName);

  return (
    <article
      // Expired opportunities look clearly different: flat, dashed, muted, and without the hover lift.
      className={cn(
        "group relative flex h-full flex-col rounded-2xl border p-5 transition-all duration-200 focus-within:ring-2 focus-within:ring-ring motion-reduce:transition-none",
        expired
          ? "border-dashed bg-muted/50 text-muted-foreground"
          : "bg-card shadow-card hover:-translate-y-0.5 hover:shadow-card-hover motion-reduce:hover:translate-y-0",
      )}
    >
      <SaveButton opportunityId={o.id} title={content.title.value} returnTo={`/opportunities/${o.slug}`} variant="icon" className="absolute right-3 top-3" />
      <div className="flex flex-wrap items-center gap-2 pr-12">
        <Badge>
          <TypeIcon aria-hidden="true" />
          {o.opportunityType === "other" && o.otherTypeLabel ? o.otherTypeLabel : t(`opportunityTypes.${o.opportunityType}`)}
        </Badge>
        {expired && <Badge variant="muted">{t("lifecycle.expired")}</Badge>}
        {o.isDemo && <Badge variant="demo">{t("demo.badge")}</Badge>}
        {verified && (
          <Badge variant="success">
            <BadgeCheck aria-hidden="true" />
            {t("verification.verified")}
          </Badge>
        )}
        {state === "closing_soon" && days !== null && <Badge variant="warning">{t("card.daysLeft", { days: Math.max(days, 0) })}</Badge>}
        {state === "upcoming" && <Badge variant="outline">{t("lifecycle.upcoming")}</Badge>}
      </div>

      <h3 className="mt-4 text-lg font-semibold leading-snug">
        {/* Stretched link: the whole card is clickable, but only the title is the accessible link. */}
        <Link
          href={`/opportunities/${o.slug}`}
          lang={content.title.language}
          className={cn("after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none", expired ? "text-muted-foreground" : "text-primary")}
        >
          {content.title.value}
        </Link>
      </h3>

      <p className="mt-1.5 flex items-start gap-1.5 text-sm text-muted-foreground">
        <Building2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0">
          {o.organization.name} · {t(`orgKinds.${o.organization.kind}`)}
        </span>
      </p>

      {content.shortDescription && (
        <p lang={content.shortDescription.language} className="mt-3 line-clamp-3 text-sm text-foreground/80">
          {content.shortDescription.value}
        </p>
      )}

      {fallbackLanguage && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
          <Languages className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{t("card.shownIn", { language: getLanguageName(fallbackLanguage) })}</span>
        </p>
      )}
      {content.hasMachineTranslation && !fallbackLanguage && (
        <p className="mt-3 text-xs text-muted-foreground">{t("translation.machine")}</p>
      )}

      <dl className="mb-5 mt-4 grid gap-1.5 text-sm">
        <div className="flex items-start gap-2">
          <dt className="sr-only">{t("card.location")}</dt>
          <MapPin className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          <dd className="min-w-0">
            {place || t("locationType.remote")}
            <span className="text-muted-foreground"> · {t(`scope.${deriveMarketScope(o)}`)}</span>
          </dd>
        </div>
        <div className="flex items-start gap-2">
          <dt className="sr-only">{t("card.format")}</dt>
          <Monitor className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          <dd>{t(`locationType.${o.locationType}`)}</dd>
        </div>
        <div className="flex items-start gap-2">
          <dt className="sr-only">{t("card.funding")}</dt>
          <Wallet className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          <dd>
            {t(`funding.${o.fundingType}`)}
            {amount && o.fundingType !== "tuition_discount" && <span className="text-muted-foreground"> · {amount}</span>}
            {o.fundingPercent !== null && <span className="text-muted-foreground"> · {format.number(o.fundingPercent / 100, { style: "percent" })}</span>}
          </dd>
        </div>
      </dl>

      <div className="mt-auto flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-t pt-4">
        <div className="min-w-0 text-sm">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="size-3.5" aria-hidden="true" />
            {expired ? t("card.ended") : t("card.deadline")}
          </p>
          <p className={cn("font-semibold", expired ? "text-muted-foreground" : "text-primary")}>{deadline}</p>
        </div>
        <p className="flex gap-1">
          <span className="sr-only">{t("card.availableIn", { languages: format.list(languageNames, { type: "conjunction" }) })}</span>
          {availableLanguages.map((l) => (
            <span key={l} aria-hidden="true" className="rounded border bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {getLanguageBadge(l)}
            </span>
          ))}
        </p>
      </div>
    </article>
  );
}
