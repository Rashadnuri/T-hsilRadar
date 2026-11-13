"use client";

import { useState, useTransition } from "react";
import { Bookmark, BookmarkCheck, ClipboardList, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { setSavedAction, trackAction } from "./actions";
import { resetPlan, setSavedLocally, setTrackedLocally, usePlan } from "./plan-store";
import type { PlanErrorCode } from "./handlers";

function useErrorText() {
  const t = useTranslations("plan.errors");
  return (code: PlanErrorCode) => t(code === "unauthorized" ? "unauthorized" : code === "not_found" ? "not_found" : code === "limit" ? "limit" : "failed");
}

/** Shared toggle logic: optimistic update, rollback on failure, redirect to login when the session ended. */
function useSaveToggle(opportunityId: string, returnTo: string) {
  const plan = usePlan();
  const router = useRouter();
  const errorText = useErrorText();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const saved = plan.saved.has(opportunityId);

  function toggle() {
    const next = !saved;
    setError(null);
    setSavedLocally(opportunityId, next); // optimistic
    startTransition(async () => {
      const result = await setSavedAction(opportunityId, next);
      if (result.ok) return;
      setSavedLocally(opportunityId, !next); // roll back
      if (result.code === "unauthorized") {
        resetPlan();
        router.push({ pathname: "/login", query: { next: returnTo } });
        return;
      }
      setError(errorText(result.code));
    });
  }
  return { plan, saved, pending, error, toggle };
}

interface SaveButtonProps {
  opportunityId: string;
  /** Used in the accessible name, e.g. the opportunity title. */
  title: string;
  /** Locale-less path to come back to after logging in. */
  returnTo: string;
  variant: "icon" | "full";
  className?: string;
}

/**
 * Save / remove-from-saved toggle. Signed-out visitors get a link to log in (full variant) or
 * nothing (icon variant on cards); the real state arrives after load, so the static HTML is the same for everyone.
 */
export function SaveButton({ opportunityId, title, returnTo, variant, className }: SaveButtonProps) {
  const t = useTranslations("plan");
  const { plan, saved, pending, error, toggle } = useSaveToggle(opportunityId, returnTo);
  const ready = plan.status === "ready";

  if (plan.status === "anonymous") {
    if (variant === "icon") return null;
    return (
      <Button asChild variant="outline" size="lg" className={cn("w-full", className)}>
        <Link href={{ pathname: "/login", query: { next: returnTo } }}>
          <Bookmark aria-hidden="true" />
          {t("save.loginToSave")}
        </Link>
      </Button>
    );
  }

  const label = saved ? t("save.remove", { title }) : t("save.add", { title });
  const Icon = saved ? BookmarkCheck : Bookmark;

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={!ready || pending}
        aria-pressed={saved}
        aria-label={label}
        title={saved ? t("save.saved") : t("save.save")}
        // z-10: above the card's stretched link, so the click toggles instead of opening the page.
        className={cn(
          "relative z-10 grid size-10 place-items-center rounded-full border bg-background text-primary shadow-soft transition-colors hover:bg-secondary disabled:opacity-60",
          saved && "border-accent text-accent",
          !ready && "invisible",
          className,
        )}
      >
        <Icon className="size-5" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className={className}>
      <Button type="button" variant={saved ? "default" : "outline"} size="lg" className="w-full" onClick={toggle} disabled={!ready || pending} aria-pressed={saved} aria-busy={!ready}>
        <Icon aria-hidden="true" />
        {saved ? t("save.saved") : t("save.save")}
      </Button>
      <p role="status" aria-live="polite" className={cn("mt-2 text-sm", error ? "text-destructive" : "sr-only")}>
        {error ?? (saved ? t("save.savedMessage") : "")}
      </p>
    </div>
  );
}

/** "Track this application" (detail page): adds it with status "interested"; afterwards links to the plan. */
export function TrackButton({ opportunityId, returnTo }: { opportunityId: string; returnTo: string }) {
  const t = useTranslations("plan");
  const tStatus = useTranslations("plan.status");
  const errorText = useErrorText();
  const plan = usePlan();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const status = plan.applications[opportunityId];

  if (plan.status === "anonymous") return null;

  if (status) {
    return (
      <div className="rounded-xl border bg-secondary px-3.5 py-3 text-sm">
        <p className="flex items-center gap-2 font-medium text-primary">
          <Check className="size-4 text-accent" aria-hidden="true" />
          {t("track.tracking", { status: tStatus(status) })}
        </p>
        <Link href="/my-plan" className="mt-1 inline-flex min-h-9 items-center font-semibold text-accent hover:underline">
          {t("track.open")}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        disabled={plan.status !== "ready" || pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await trackAction(opportunityId);
            if (result.ok) return setTrackedLocally(opportunityId, result.status);
            if (result.code === "unauthorized") {
              resetPlan();
              router.push({ pathname: "/login", query: { next: returnTo } });
              return;
            }
            setError(errorText(result.code));
          });
        }}
      >
        <ClipboardList aria-hidden="true" />
        {pending ? t("track.adding") : t("track.add")}
      </Button>
      <p role="status" aria-live="polite" className={cn("mt-2 text-sm", error ? "text-destructive" : "sr-only")}>
        {error ?? ""}
      </p>
    </div>
  );
}
