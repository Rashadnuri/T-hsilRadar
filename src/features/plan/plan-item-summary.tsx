import { Building2, CalendarClock, TriangleAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatDateTimeInZone } from "@/lib/format";
import { resolveContent } from "@/lib/opportunities/translations";
import { cn } from "@/lib/utils";
import type { PlanItem } from "./plan-view";

/** The read-only part of a plan row: title, organization and — importantly — the deadline situation. */
export async function PlanItemSummary({ item, locale }: { item: PlanItem; locale: Locale }) {
  const [t, tCard, tLife] = await Promise.all([getTranslations("plan"), getTranslations("card"), getTranslations("lifecycle")]);
  const { record: o, state, daysLeft } = item;

  if (!o) {
    return (
      <div>
        <h3 className="flex items-start gap-2 text-lg font-semibold text-muted-foreground">
          <TriangleAlert className="mt-1 size-4 shrink-0" aria-hidden="true" />
          {t("item.unavailable.title")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("item.unavailable.text")}</p>
      </div>
    );
  }

  const content = resolveContent(o, locale);
  const expired = state === "expired";
  const fixed = o.deadlineType === "fixed" && o.applicationDeadline !== null;
  const deadlineText = fixed ? formatDateTimeInZone(o.applicationDeadline!, locale, o.deadlineTimezone) : null;

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        {expired && <Badge variant="muted">{tLife("expired")}</Badge>}
        {state === "closing_soon" && daysLeft !== null && <Badge variant="warning">{tCard("daysLeft", { days: Math.max(daysLeft, 0) })}</Badge>}
        {state === "open" && daysLeft !== null && <Badge variant="outline">{tCard("daysLeft", { days: daysLeft })}</Badge>}
        {state === "upcoming" && <Badge variant="outline">{tLife("upcoming")}</Badge>}
        {o.isDemo && <Badge variant="demo">{(await getTranslations("demo"))("badge")}</Badge>}
      </div>

      <h3 className="mt-2 text-lg font-semibold leading-snug">
        <Link href={`/opportunities/${o.slug}`} lang={content.title.language} className={cn("hover:underline", expired ? "text-muted-foreground" : "text-primary")}>
          {content.title.value}
        </Link>
      </h3>
      <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
        <Building2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0">{o.organization.name}</span>
      </p>

      <p className={cn("mt-3 flex items-start gap-1.5 text-sm", expired ? "text-muted-foreground" : "text-primary")}>
        <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          <span className="font-medium">{expired ? (deadlineText ? t("deadline.endedOn", { date: deadlineText }) : tLife("expired")) : `${t("deadline.label")}: `}</span>
          {!expired &&
            (fixed
              ? deadlineText
              : state === "upcoming" && o.applicationStartDate
                ? t("deadline.opensOn", { date: formatDateTimeInZone(o.applicationStartDate, locale, o.deadlineTimezone) })
                : o.deadlineType === "rolling"
                  ? tLife("rolling")
                  : tLife("unknown"))}
        </span>
      </p>
      {expired && <p className="mt-1 text-xs text-muted-foreground">{t("deadline.expiredNote")}</p>}
    </div>
  );
}
