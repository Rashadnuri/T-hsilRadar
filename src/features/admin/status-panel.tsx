"use client";

import { useState, useTransition } from "react";
import { ExternalLink, ShieldCheck, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { PublicationBlocker } from "@/lib/opportunities/status";
import { canTransitionPublication } from "@/lib/opportunities/status";
import { ADMIN_PUBLICATION_STATUSES, type AdminPublicationStatus } from "@/types/admin";
import type { PublicationStatus } from "@/types/opportunity";
import { deleteOpportunityAction, setStatusAction, setVerificationAction, type AdminActionResult } from "./actions";

interface StatusPanelProps {
  id: string;
  status: PublicationStatus;
  verified: boolean;
  /** Already formatted on the server (dates differ slightly between Node and browsers). */
  verifiedOn: string | null;
  officialSourceUrl: string | null;
  isDemo: boolean;
  /** Everything currently stopping publication (computed on the server). */
  blockers: PublicationBlocker[];
}

const LABEL: Record<AdminPublicationStatus, "in_review" | "published" | "rejected" | "archived" | "draft"> = {
  in_review: "in_review", published: "published", rejected: "rejected", archived: "archived", draft: "draft",
};

/** Status transitions, verification and deletion. Buttons only mirror what the server allows: the server decides. */
export function StatusPanel({ id, status, verified, verifiedOn, officialSourceUrl, isDemo, blockers }: StatusPanelProps) {
  const t = useTranslations("admin.workflow");
  const tStatus = useTranslations("admin.status");
  const tErr = useTranslations("admin.errors");
  const tBlock = useTranslations("admin.workflow.blockers");
  const tVerification = useTranslations("admin.verification");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string; blockers?: PublicationBlocker[] } | null>(null);

  const run = (work: () => Promise<AdminActionResult>, okText?: string) =>
    startTransition(async () => {
      const result = await work();
      if (result.ok) setMessage({ kind: "ok", text: okText ?? t("done") });
      else setMessage({ kind: "error", text: tErr((result.code ?? "failed") as never, { fields: "" } as never), blockers: result.blockers });
    });

  const targets = ADMIN_PUBLICATION_STATUSES.filter((target) => canTransitionPublication(status, target));
  const actionLabel = (target: AdminPublicationStatus) => (status === "published" && target === "draft" ? t("actions.unpublish") : t(`actions.${LABEL[target]}` as never));

  return (
    <section aria-labelledby="workflow-heading" className="space-y-5 rounded-2xl border bg-card p-5 shadow-soft sm:p-6" data-testid="status-panel" data-status={status} data-verified={verified ? "true" : "false"}>
      <h2 id="workflow-heading" className="text-lg font-semibold">
        {t("title")}
      </h2>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">{`${t("current")}:`}</span>
        <span className="rounded-full bg-secondary px-3 py-1 text-sm font-semibold text-primary" data-testid="current-status">
          {tStatus(status as never)}
        </span>
        <span className={verified ? "rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-900" : "rounded-full bg-muted px-3 py-1 text-sm font-semibold text-muted-foreground"} data-testid="current-verification">
          {tVerification(verified ? "verified" : "unverified")}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {targets.map((target) => (
          <Button key={target} type="button" size="sm" variant={target === "published" ? "accent" : target === "rejected" || target === "archived" ? "outline" : "default"} disabled={pending} data-target={target} onClick={() => run(() => setStatusAction(id, target))}>
            {pending ? t("working") : actionLabel(target)}
          </Button>
        ))}
      </div>

      {status !== "published" && (
        <div data-testid="requirements">
          <h3 className="mb-2 text-sm font-semibold text-primary">{t("requirementsTitle")}</h3>
          {blockers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("requirementsMet")}</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-sm text-foreground/80">
              {blockers.map((b) => (
                <li key={b} data-blocker={b}>
                  {tBlock(b)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="border-t pt-5">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary">
          <ShieldCheck className="size-4 text-accent" aria-hidden="true" />
          {t("verifyTitle")}
        </h3>
        {officialSourceUrl ? (
          <a href={officialSourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="mb-2 inline-flex min-h-9 items-center gap-2 break-all text-sm font-semibold text-accent hover:underline">
            {t("openSource")}
            <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
          </a>
        ) : (
          <p className="mb-2 text-sm text-muted-foreground">{t("noSource")}</p>
        )}
        <p className="mb-3 text-xs text-muted-foreground">{t("verifyHint")}</p>
        {verified && verifiedOn && <p className="mb-3 text-sm text-primary">{t("verifiedOn", { date: verifiedOn })}</p>}
        {!isDemo &&
          (verified ? (
            <Button type="button" size="sm" variant="outline" disabled={pending} data-action="unverify" onClick={() => run(() => setVerificationAction(id, false))}>
              {t("unverify")}
            </Button>
          ) : (
            <Button type="button" size="sm" disabled={pending || !officialSourceUrl} data-action="verify" onClick={() => run(() => setVerificationAction(id, true))}>
              {t("verify")}
            </Button>
          ))}
      </div>

      <div aria-live="polite">
        {message && (
          <div role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-sm text-destructive" : "text-sm text-primary"} data-testid="workflow-message" data-kind={message.kind}>
            <p>{message.text}</p>
            {message.blockers && message.blockers.length > 0 && (
              <ul className="ml-5 mt-1 list-disc">
                {message.blockers.map((b) => (
                  <li key={b} data-blocker={b}>
                    {tBlock(b)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {status !== "published" && (
        <div className="border-t pt-5">
          <h3 className="mb-2 text-sm font-semibold text-primary">{t("deleteTitle")}</h3>
          <p className="mb-3 text-xs text-muted-foreground">{t("deleteHint")}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            data-action="delete"
            onClick={() => {
              if (!window.confirm(t("deleteConfirm"))) return;
              run(() => deleteOpportunityAction(id));
            }}
          >
            <Trash2 aria-hidden="true" />
            {t("delete")}
          </Button>
        </div>
      )}
    </section>
  );
}
