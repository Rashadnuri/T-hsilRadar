"use client";

import { useActionState, useTransition, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ErrorText, FocusFirstError, useFieldErrorText } from "@/features/auth/form-parts";
import { Link } from "@/i18n/navigation";
import { ORGANIZATION_KINDS } from "@/types/opportunity";
import { ACCESS_METHODS } from "@/types/source";
import { saveSourceAction, type SourceFormState } from "./import-actions";

interface Option {
  value: string;
  label: string;
}

export interface SourceFormProps {
  initial: { id?: string; organizationName: string; websiteUrl: string; sourceType: string; country: string; accessMethod: string; notes: string; isActive: boolean; organizationId: string };
  countries: Option[];
  organizations: Option[];
}

const idle: SourceFormState = { status: "idle" };

export function SourceForm({ initial, countries, organizations }: SourceFormProps) {
  const t = useTranslations("admin.sources");
  const tKind = useTranslations("orgKinds");
  const tErr = useTranslations("admin.errors");
  const text = useFieldErrorText();
  const [state, action, pendingAction] = useActionState(saveSourceAction, idle);
  const [submitting, startSubmitting] = useTransition();
  const pending = pendingAction || submitting;
  const e = state.fieldErrors ?? {};
  const editing = Boolean(initial.id);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startSubmitting(() => action(data));
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-2xl border bg-card p-5 shadow-soft sm:p-6" data-testid="source-form">
      <FocusFirstError trigger={state} />
      <h2 className="text-lg font-semibold">{editing ? t("edit") : t("new")}</h2>
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      {state.status === "success" && (
        <p role="status" className="flex items-center gap-2 text-sm text-primary" data-testid="source-saved">
          <CheckCircle2 className="size-4 text-accent" aria-hidden="true" />
          {t("saved")}
        </p>
      )}
      {state.status === "error" && state.code && state.code !== "invalid" && (
        <p role="alert" className="text-sm text-destructive" data-testid="source-error" data-code={state.code}>
          {tErr(state.code)}
        </p>
      )}
      <div>
        <Label htmlFor="src-name">{t("fields.organizationName")}</Label>
        <Input id="src-name" name="organizationName" defaultValue={initial.organizationName} aria-invalid={!!e.organizationName} />
        <ErrorText id="src-name-err" message={text(e.organizationName)} />
      </div>
      <div>
        <Label htmlFor="src-url">{t("fields.websiteUrl")}</Label>
        <Input id="src-url" name="websiteUrl" type="url" inputMode="url" placeholder="https://" defaultValue={initial.websiteUrl} aria-invalid={!!e.websiteUrl} />
        <ErrorText id="src-url-err" message={text(e.websiteUrl)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="src-kind">{t("fields.sourceType")}</Label>
          <Select id="src-kind" name="sourceType" defaultValue={initial.sourceType} aria-invalid={!!e.sourceType}>
            <option value="">{"—"}</option>
            {ORGANIZATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {tKind(k)}
              </option>
            ))}
          </Select>
          <ErrorText id="src-kind-err" message={text(e.sourceType)} />
        </div>
        <div>
          <Label htmlFor="src-country">{t("fields.country")}</Label>
          <Select id="src-country" name="country" defaultValue={initial.country}>
            <option value="">{"—"}</option>
            {countries.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          <ErrorText id="src-country-err" message={text(e.country)} />
        </div>
        <div>
          <Label htmlFor="src-access">{t("fields.accessMethod")}</Label>
          <Select id="src-access" name="accessMethod" defaultValue={initial.accessMethod}>
            {ACCESS_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`accessMethods.${m}`)}
              </option>
            ))}
          </Select>
          <ErrorText id="src-access-err" message={text(e.accessMethod)} />
        </div>
        <div>
          <Label htmlFor="src-org">{t("fields.organization")}</Label>
          <Select id="src-org" name="organizationId" defaultValue={initial.organizationId}>
            <option value="">{"—"}</option>
            {organizations.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="src-notes">{t("fields.notes")}</Label>
        <Textarea id="src-notes" name="notes" rows={3} defaultValue={initial.notes} aria-invalid={!!e.notes} />
        <ErrorText id="src-notes-err" message={text(e.notes)} />
      </div>
      <Label className="mb-0 flex min-h-10 cursor-pointer items-center gap-3 font-normal">
        <input type="checkbox" name="isActive" defaultChecked={initial.isActive} className="size-4 accent-[var(--accent)]" />
        {t("fields.isActive")}
      </Label>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending} data-testid="save-source">
          {pending ? t("working") : editing ? t("save") : t("create")}
        </Button>
        {editing && (
          <Button asChild variant="outline">
            <Link href="/admin/sources">{t("cancel")}</Link>
          </Button>
        )}
      </div>
    </form>
  );
}
