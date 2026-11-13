"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlan } from "@/features/plan/plan-store";
import { Link } from "@/i18n/navigation";
import type { MatchResult } from "@/lib/matching/types";
import { AiAssistant } from "./ai-assistant";
import { MatchView } from "./match-view";

interface Loaded {
  match: MatchResult;
  hasProfile: boolean;
  ai: { available: boolean };
}
type State = { status: "loading" } | { status: "error" } | ({ status: "ready" } & Loaded);

/**
 * "How well it fits you" on the (static) detail page. For signed-in visitors it asks the server
 * to compare their profile with this record; the rule-based result never depends on AI. The AI
 * assistant appears below it only when the server says AI is available.
 */
export function MatchPanel({ opportunityId, slug }: { opportunityId: string; slug: string }) {
  const t = useTranslations("matching");
  const tAi = useTranslations("ai");
  const plan = usePlan();
  const [state, setState] = useState<State>({ status: "loading" });
  const signedOut = plan.status === "anonymous";

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (plan.status !== "ready" && plan.status !== "error") return;
    let cancelled = false;
    fetch(`/api/matching/${encodeURIComponent(opportunityId)}`, { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => (response.ok ? ({ status: "ready", ...((await response.json()) as Loaded) } as State) : ({ status: "error" } as State)))
      .catch((): State => ({ status: "error" }))
      .then((next) => {
        if (!cancelled) setState(next);
      });
    return () => {
      cancelled = true;
    };
  }, [opportunityId, plan.status, attempt]);

  return (
    <section aria-labelledby="match-heading" className="rounded-2xl border bg-card p-5 shadow-card sm:p-6" data-testid="match-panel">
      <h2 id="match-heading" className="text-xl font-semibold text-primary">
        {t("panel.title")}
      </h2>

      {signedOut ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted-foreground">{t("panel.login")}</p>
          <Button asChild size="sm">
            <Link href={{ pathname: "/login", query: { next: `/opportunities/${slug}` } }}>{t("panel.loginLink")}</Link>
          </Button>
        </div>
      ) : state.status === "loading" || plan.status === "unknown" || plan.status === "loading" ? (
        <div className="mt-4 space-y-3" aria-busy="true" data-testid="match-loading">
          <p role="status" className="sr-only">
            {t("panel.loading")}
          </p>
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : state.status === "error" ? (
        <div className="mt-3 space-y-3">
          <p role="alert" className="text-sm text-destructive">
            {t("panel.error")}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => {
              setState({ status: "loading" });
              setAttempt((n) => n + 1);
            }}>
            {t("panel.retry")}
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-6">
          {!state.hasProfile && (
            <p className="flex flex-wrap items-center gap-3 rounded-lg bg-secondary px-3 py-2 text-sm text-primary">
              {t("panel.noProfile")}
              <Link href="/profile" className="font-semibold text-accent hover:underline">
                {t("panel.completeProfile")}
              </Link>
            </p>
          )}
          <MatchView match={state.match} />
          {state.ai.available ? <AiAssistant opportunityId={opportunityId} /> : <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground" data-testid="ai-unavailable">{tAi("unavailable")}</p>}
        </div>
      )}
    </section>
  );
}
