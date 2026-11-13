"use client";

import { useActionState, useTransition, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ErrorText, FocusFirstError, useFieldErrorText } from "@/features/auth/form-parts";
import { Link } from "@/i18n/navigation";
import { ORGANIZATION_KINDS } from "@/types/opportunity";
import { saveOrganizationAction, type AdminFormState } from "./actions";

interface Option {
  value: string;
  label: string;
}

export interface OrganizationFormProps {
  initial: { id?: string; name: string; slug: string; kind: string; country: string; websiteUrl: string };
  countries: Option[];
}

const idle: AdminFormState = { status: "idle" };

export function OrganizationForm({ initial, countries }: OrganizationFormProps) {
  const t = useTranslations("admin.orgs");
  const tKind = useTranslations("orgKinds");
  const tErr = useTranslations("admin.errors");
  const text = useFieldErrorText();
  const [state, action, pendingAction] = useActionState(saveOrganizationAction, idle);
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
    <form onSubmit={submit} noValidate className="space-y-4 rounded-2xl border bg-card p-5 shadow-soft sm:p-6" data-testid="organization-form">
      <FocusFirstError trigger={state} />
      <h2 className="text-lg font-semibold">{editing ? t("edit") : t("new")}</h2>
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      {state.status === "success" && (
        <p role="status" className="flex items-center gap-2 text-sm text-primary" data-testid="org-saved">
          <CheckCircle2 className="size-4 text-accent" aria-hidden="true" />
          {t("saved")}
        </p>
      )}
      {state.status === "error" && state.code && state.code !== "invalid" && (
        <p role="alert" className="text-sm text-destructive" data-testid="org-error" data-code={state.code}>
          {tErr(state.code)}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="org-name">{t("fields.name")}</Label>
          <Input id="org-name" name="name" defaultValue={initial.name} aria-invalid={!!e.name} />
          <ErrorText id="org-name-err" message={text(e.name)} />
        </div>
        <div>
          <Label htmlFor="org-slug">{t("fields.slug")}</Label>
          <Input id="org-slug" name="slug" defaultValue={initial.slug} aria-invalid={!!e.slug} />
          <ErrorText id="org-slug-err" message={text(e.slug)} />
        </div>
        <div>
          <Label htmlFor="org-kind">{t("fields.kind")}</Label>
          <Select id="org-kind" name="kind" defaultValue={initial.kind} aria-invalid={!!e.kind}>
            <option value="">{"—"}</option>
            {ORGANIZATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {tKind(k)}
              </option>
            ))}
          </Select>
          <ErrorText id="org-kind-err" message={text(e.kind)} />
        </div>
        <div>
          <Label htmlFor="org-country">{t("fields.country")}</Label>
          <Select id="org-country" name="country" defaultValue={initial.country}>
            <option value="">{"—"}</option>
            {countries.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          <ErrorText id="org-country-err" message={text(e.country)} />
        </div>
        <div>
          <Label htmlFor="org-website">{t("fields.website")}</Label>
          <Input id="org-website" name="websiteUrl" type="url" inputMode="url" placeholder="https://" defaultValue={initial.websiteUrl} aria-invalid={!!e.websiteUrl} />
          <ErrorText id="org-website-err" message={text(e.websiteUrl)} />
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending} data-testid="save-organization">
          {pending ? t("working") : editing ? t("save") : t("create")}
        </Button>
        {editing && (
          <Button asChild variant="outline">
            <Link href="/admin/organizations">{t("cancel")}</Link>
          </Button>
        )}
      </div>
    </form>
  );
}
