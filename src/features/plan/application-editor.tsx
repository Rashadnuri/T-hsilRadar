"use client";

import { useActionState, useEffect, useState, useTransition, type FormEvent } from "react";
import { CheckCircle2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/input";
import { ErrorText, FocusFirstError, useFieldErrorText } from "@/features/auth/form-parts";
import { APPLICATION_STATUSES, PLAN_LIMITS, type ApplicationStatus } from "@/types/plan";
import { untrackAction, updateApplicationAction, type ApplicationFormState } from "./actions";
import { resetPlan } from "./plan-store";

interface ApplicationEditorProps {
  opportunityId: string;
  initialStatus: ApplicationStatus;
  initialNotes: string | null;
  /** The last change, already formatted on the server (Intl output differs slightly between Node and browsers, which would break hydration). */
  updatedText: string;
}

const idle: ApplicationFormState = { status: "idle" };

/** Status selector + PRIVATE notes for one application. Controlled fields, so a failed save keeps what was typed. */
export function ApplicationEditor({ opportunityId, initialStatus, initialNotes, updatedText }: ApplicationEditorProps) {
  const t = useTranslations("plan");
  const tStatus = useTranslations("plan.status");
  const tErr = useTranslations("plan.errors");
  const text = useFieldErrorText();
  const [state, action, pendingAction] = useActionState(updateApplicationAction, idle);
  const [submitting, startSubmitting] = useTransition();
  const pending = pendingAction || submitting;
  const [status, setStatus] = useState<ApplicationStatus>(initialStatus);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [removing, startRemoving] = useTransition();
  const [removeError, setRemoveError] = useState(false);
  const errors = state.fieldErrors ?? {};

  // A saved change must also refresh the (client-cached) save/track state used on other pages.
  useEffect(() => {
    if (state.status === "success") resetPlan();
  }, [state]);

  // Submitted by hand instead of `<form action>`: React would reset the form after the action,
  // which snaps selects back to their initial value. The fields are controlled and must keep what was saved.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startSubmitting(() => action(data));
  }

  const id = `app-${opportunityId}`;
  return (
    <div className="mt-5 border-t pt-5">
      <form onSubmit={submit} noValidate className="space-y-4">
        <FocusFirstError trigger={state} />
        <input type="hidden" name="opportunityId" value={opportunityId} />
        <div className="grid gap-4 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
          <div>
            <Label htmlFor={`${id}-status`}>{t("application.status")}</Label>
            <Select id={`${id}-status`} name="status" value={status} onChange={(e) => setStatus(e.target.value as ApplicationStatus)} aria-invalid={!!errors.status}>
              {APPLICATION_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {tStatus(value)}
                </option>
              ))}
            </Select>
            <ErrorText id={`${id}-status-err`} message={text(errors.status)} />
          </div>
          <div>
            <Label htmlFor={`${id}-notes`}>{t("application.notes")}</Label>
            <Textarea
              id={`${id}-notes`}
              name="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder={t("application.notesPlaceholder")}
              aria-describedby={`${id}-notes-hint`}
              aria-invalid={!!errors.notes}
              className="min-h-24"
            />
            <p id={`${id}-notes-hint`} className="mt-1.5 text-xs text-muted-foreground">
              {t("application.notesHint", { max: PLAN_LIMITS.notesMax })}
            </p>
            <ErrorText id={`${id}-notes-err`} message={text(errors.notes)} />
          </div>
        </div>

        {state.status === "error" && state.code && state.code !== "invalid" && (
          <p role="alert" className="text-sm text-destructive">
            {tErr(state.code)}
          </p>
        )}
        {state.status === "success" && (
          <p role="status" className="flex items-center gap-2 text-sm text-primary">
            <CheckCircle2 className="size-4 text-accent" aria-hidden="true" />
            {t("application.saved")}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending || removing}>
            {pending ? t("application.saving") : t("application.save")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending || removing}
            onClick={() => {
              if (!window.confirm(t("application.stopConfirm"))) return;
              setRemoveError(false);
              startRemoving(async () => {
                const result = await untrackAction(opportunityId);
                if (result.ok) resetPlan();
                else setRemoveError(true);
              });
            }}
          >
            <Trash2 aria-hidden="true" />
            {removing ? t("application.stopping") : t("application.stop")}
          </Button>
          <p className="text-xs text-muted-foreground sm:ml-auto">{t("application.updated", { date: updatedText })}</p>
        </div>
        {removeError && (
          <p role="alert" className="text-sm text-destructive">
            {tErr("failed")}
          </p>
        )}
      </form>
    </div>
  );
}
