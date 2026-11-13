import { ExternalLink } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/routing";
import { formatDateTimeInZone } from "@/lib/format";
import type { ApplicationState } from "@/lib/opportunities/deadline";
import { isSafeHttpsUrl } from "@/lib/opportunities/source";
import type { OpportunityRecord } from "@/types/opportunity";

interface ApplyActionProps {
  record: OpportunityRecord;
  state: ApplicationState;
  locale: Locale;
}

/**
 * The apply button never submits an application itself: it opens the organization's own
 * application page. It is disabled when applications are closed or not open yet, and it only
 * links to URLs that pass the safety check (https, public host, no credentials).
 */
export async function ApplyAction({ record: o, state, locale }: ApplyActionProps) {
  const t = await getTranslations("detail.apply");
  const target = o.applicationUrl ?? o.officialSourceUrl;
  const usable = target !== null && isSafeHttpsUrl(target);

  if (state === "expired" || state === "upcoming" || !usable) {
    const reason =
      state === "upcoming" && o.applicationStartDate
        ? t("upcoming", { date: formatDateTimeInZone(o.applicationStartDate, locale, o.deadlineTimezone) })
        : t("closed");
    return (
      <div>
        <Button size="lg" className="w-full" disabled>
          {state === "upcoming" ? t("button") : t("closed")}
        </Button>
        {state === "upcoming" && <p className="mt-2 text-sm text-muted-foreground">{reason}</p>}
      </div>
    );
  }

  return (
    <div>
      <Button asChild size="lg" variant="accent" className="h-auto min-h-12 w-full whitespace-normal py-2 text-center">
        <a href={target} target="_blank" rel="noopener noreferrer nofollow">
          {t("button")}
          <ExternalLink aria-hidden="true" />
          <span className="sr-only">({t("newTab")})</span>
        </a>
      </Button>
      {state === "deadline_unknown" && <p className="mt-2 text-sm text-muted-foreground">{t("checkDeadline")}</p>}
      {o.isDemo && <p className="mt-2 text-xs text-amber-900">{t("demoNote")}</p>}
    </div>
  );
}
