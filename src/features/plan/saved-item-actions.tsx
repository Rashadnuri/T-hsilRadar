"use client";

import { useState, useTransition } from "react";
import { BookmarkX, ClipboardList } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { ApplicationStatus } from "@/types/plan";
import { setSavedAction, trackAction } from "./actions";
import { resetPlan } from "./plan-store";

interface SavedItemActionsProps {
  opportunityId: string;
  /** Accessible name of the opportunity. */
  title: string;
  /** Current application status when it is already being tracked. */
  trackedStatus: ApplicationStatus | null;
  /** Tracking needs a public opportunity; an unavailable one can only be removed. */
  canTrack: boolean;
}

export function SavedItemActions({ opportunityId, title, trackedStatus, canTrack }: SavedItemActionsProps) {
  const t = useTranslations("plan");
  const tStatus = useTranslations("plan.status");
  const tErr = useTranslations("plan.errors");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (work: () => Promise<{ ok: boolean; code?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (result.ok) return resetPlan();
      setError(tErr(result.code === "not_found" ? "not_found" : result.code === "limit" ? "limit" : result.code === "unauthorized" ? "unauthorized" : "failed"));
    });
  };

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {trackedStatus ? (
        <p className="mr-1 inline-flex min-h-9 items-center text-sm font-medium text-primary">{t("savedItem.tracked", { status: tStatus(trackedStatus) })}</p>
      ) : (
        canTrack && (
          <Button type="button" size="sm" disabled={pending} onClick={() => run(() => trackAction(opportunityId))}>
            <ClipboardList aria-hidden="true" />
            {pending ? t("savedItem.working") : t("savedItem.track")}
          </Button>
        )
      )}
      <Button type="button" size="sm" variant="outline" disabled={pending} aria-label={t("savedItem.removeLabel", { title })} onClick={() => run(() => setSavedAction(opportunityId, false))}>
        <BookmarkX aria-hidden="true" />
        {t("savedItem.remove")}
      </Button>
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
