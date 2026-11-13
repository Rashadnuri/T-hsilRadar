"use client";

import { useActionState, useState, useTransition, type FormEvent } from "react";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ErrorText, FocusFirstError, useFieldErrorText } from "@/features/auth/form-parts";
import type { FormValues, TranslationSlotState } from "@/lib/admin/form-values";
import { DEADLINE_TYPES, EDUCATION_LEVELS, FIELDS_OF_STUDY, FUNDING_PERIODS, FUNDING_TYPES, LOCATION_TYPES, OPPORTUNITY_TYPES } from "@/types/opportunity";
import { reviewTranslationAction, saveOpportunityAction, type AdminFormState } from "./actions";

interface Option {
  value: string;
  label: string;
}

export interface OpportunityFormProps {
  mode: "create" | "edit";
  id?: string;
  values: FormValues;
  organizations: Option[];
  countries: Option[];
  cities: Option[];
  /** Localized language names for every language an original may be written in (az, ru, en first). */
  originalLanguageOptions: Option[];
  /** What exists today per language (empty on create). */
  states: Record<string, TranslationSlotState>;
  notice?: "created" | "saved" | null;
}

const idle: AdminFormState = { status: "idle" };
const str = (v: string | string[] | undefined) => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-5 rounded-2xl border bg-card p-5 shadow-soft sm:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function OpportunityForm({ mode, id, values, organizations, countries, cities, originalLanguageOptions, states, notice }: OpportunityFormProps) {
  const t = useTranslations("admin.form");
  const tTr = useTranslations("admin.tr");
  const tType = useTranslations("opportunityTypes");
  const tLevel = useTranslations("level");
  const tField = useTranslations("fields");
  const tFunding = useTranslations("funding");
  const tLocation = useTranslations("locationType");
  const tErr = useTranslations("admin.errors");
  const tChanged = useTranslations("admin.changed");
  const tBlock = useTranslations("admin.workflow.blockers");
  const text = useFieldErrorText();
  const [state, action, pendingAction] = useActionState(saveOpportunityAction, idle);
  const [submitting, startSubmitting] = useTransition();
  const pending = pendingAction || submitting;
  const [opportunityType, setOpportunityType] = useState(str(values.opportunityType));
  const [deadlineType, setDeadlineType] = useState(str(values.deadlineType));
  const [fundingType, setFundingType] = useState(str(values.fundingType));
  const [originalLanguage, setOriginalLanguage] = useState(str(values.originalLanguage) || "az");
  // az, ru and en always have a section; an original in another language gets its own (preserved in its own language).
  const labelOf = (code: string) => originalLanguageOptions.find((o) => o.value === code)?.label ?? code;
  const sectionCodes = [...new Set(["az", "ru", "en", originalLanguage])];
  const languages = sectionCodes.map((code) => ({ code, label: labelOf(code), original: code === originalLanguage, state: (code === originalLanguage && !states[code] ? "original" : (states[code] ?? "missing")) as TranslationSlotState }));
  const [reviewing, startReviewing] = useTransition();
  const [reviewError, setReviewError] = useState<string | null>(null);
  const e = state.fieldErrors ?? {};

  // Not `<form action>`: React would reset the form after the action; admins must keep what they typed (also after an error).
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startSubmitting(() => action(data));
  }

  const field = (name: string, label: string, control: (p: { id: string; "aria-invalid"?: boolean }) => React.ReactNode, hint?: string) => (
    <div>
      <Label htmlFor={`f-${name}`}>{label}</Label>
      {control({ id: `f-${name}`, "aria-invalid": e[name] ? true : undefined })}
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
      <ErrorText id={`err-${name}`} message={text(e[name])} />
    </div>
  );
  const input = (name: string, label: string, extra: React.ComponentProps<"input"> = {}, hint?: string) =>
    field(name, label, (p) => <Input {...p} name={name} defaultValue={str(values[name])} {...extra} />, hint);
  const select = (name: string, label: string, options: Option[], extra: { onChange?: (v: string) => void; blank?: boolean; hint?: string } = {}) =>
    field(
      name,
      label,
      (p) => (
        <Select {...p} name={name} defaultValue={str(values[name])} onChange={extra.onChange ? (ev) => extra.onChange!(ev.target.value) : undefined}>
          {extra.blank !== false && <option value="">{t("choose")}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ),
      extra.hint,
    );
  const checks = (name: string, label: string, options: Option[]) => (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-primary">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <Label key={o.value} className="mb-0 flex min-h-10 cursor-pointer items-center gap-3 rounded-lg border bg-background px-3 py-2 font-normal hover:bg-secondary">
            <input type="checkbox" name={name} value={o.value} defaultChecked={list(values[name]).includes(o.value)} className="size-4 accent-[var(--accent)]" />
            {o.label}
          </Label>
        ))}
      </div>
      <ErrorText id={`err-${name}`} message={text(e[name])} />
    </fieldset>
  );

  const stateLabel = (s: TranslationSlotState) => tTr(`states.${s}` as never);

  return (
    <form onSubmit={submit} noValidate className="space-y-6" data-testid="opportunity-form">
      <FocusFirstError trigger={state} />
      {id && <input type="hidden" name="id" value={id} />}

      {notice && (
        <p role="status" className="flex items-start gap-2.5 rounded-xl border border-accent/25 bg-secondary px-3.5 py-3 text-sm text-primary">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          {notice === "created" ? t("createdNotice") : t("savedNotice")}
        </p>
      )}
      {state.status === "success" && (
        <p role="status" className="flex items-start gap-2.5 rounded-xl border border-accent/25 bg-secondary px-3.5 py-3 text-sm text-primary" data-testid="save-success">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          {state.message === "saved_unverified" ? t("savedUnverifiedNotice") : t("savedNotice")}
        </p>
      )}
      {state.status === "error" && state.code && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-sm text-destructive" data-testid="save-error" data-code={state.code}>
          <p className="flex items-start gap-2.5">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {state.code === "critical_change_published" ? tErr("critical_change_published", { fields: (state.changed ?? []).map((c) => tChanged(c as never)).join(", ") }) : tErr(state.code)}
          </p>
          {state.blockers && state.blockers.length > 0 && (
            <ul className="ml-6 mt-2 list-disc">
              {state.blockers.map((b) => (
                <li key={b}>{tBlock(b)}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Section title={t("sections.basics")}>
        <div className="grid gap-5 sm:grid-cols-2">
          {select("organizationId", t("fields.organization"), organizations, { hint: t("hints.required") })}
          {select("opportunityType", t("fields.type"), OPPORTUNITY_TYPES.map((v) => ({ value: v, label: tType(v) })), { blank: false, onChange: setOpportunityType })}
          {opportunityType === "other" && input("otherTypeLabel", t("fields.otherLabel"))}
          {input("slug", t("fields.slug"), {}, t("hints.slug"))}
          {mode === "create"
            ? select("originalLanguage", t("fields.originalLanguage"), originalLanguageOptions, { blank: false, hint: t("hints.originalLanguage"), onChange: setOriginalLanguage })
            : field("originalLanguage", t("fields.originalLanguage"), (p) => <Input {...p} value={originalLanguageOptions.find((o) => o.value === str(values.originalLanguage))?.label ?? str(values.originalLanguage)} readOnly disabled />, t("hints.originalLanguage"))}
        </div>
        <Label className="mb-0 flex min-h-10 cursor-pointer items-center gap-3 font-normal">
          <input type="checkbox" name="featured" defaultChecked={str(values.featured) === "on"} className="size-4 accent-[var(--accent)]" />
          {t("fields.featured")}
        </Label>
      </Section>

      <Section title={t("sections.location")}>
        <div className="grid gap-5 sm:grid-cols-2">
          {select("locationType", t("fields.locationType"), LOCATION_TYPES.map((v) => ({ value: v, label: tLocation(v) })), { blank: false })}
          {select("country", t("fields.country"), countries, { hint: t("hints.required") })}
          {select("cityId", t("fields.city"), cities)}
          {input("cityText", t("fields.cityText"))}
        </div>
      </Section>

      <Section title={t("sections.eligibility")}>
        {checks("educationLevels", t("fields.educationLevels"), EDUCATION_LEVELS.map((v) => ({ value: v, label: tLevel(v) })))}
        {checks("eligibleFields", t("fields.eligibleFields"), FIELDS_OF_STUDY.map((v) => ({ value: v, label: tField(v) })))}
        {input("eligibleCountries", t("fields.eligibleCountries"), { placeholder: "AZ, TR" })}
      </Section>

      <Section title={t("sections.funding")}>
        <div className="grid gap-5 sm:grid-cols-2">
          {select("fundingType", t("fields.fundingType"), FUNDING_TYPES.map((v) => ({ value: v, label: tFunding(v) })), { blank: false, onChange: setFundingType })}
          {input("fundingAmount", t("fields.fundingAmount"), { inputMode: "decimal" })}
          {input("fundingCurrency", t("fields.fundingCurrency"), { maxLength: 3, placeholder: "EUR" })}
          {select("fundingPeriod", t("fields.fundingPeriod"), FUNDING_PERIODS.map((v) => ({ value: v, label: t(`fundingPeriod.${v}`) })))}
          {fundingType === "tuition_discount" && input("fundingPercent", t("fields.fundingPercent"), { inputMode: "numeric" })}
          {input("feeAmount", t("fields.feeAmount"), { inputMode: "decimal" })}
          {input("feeCurrency", t("fields.feeCurrency"), { maxLength: 3, placeholder: "EUR" })}
        </div>
      </Section>

      <Section title={t("sections.dates")}>
        <div className="grid gap-5 sm:grid-cols-2">
          {select("deadlineType", t("fields.deadlineType"), DEADLINE_TYPES.map((v) => ({ value: v, label: t(`deadlineType.${v}`) })), { blank: false, onChange: setDeadlineType, hint: deadlineType === "unknown" ? t("hints.unknownDeadline") : undefined })}
          {deadlineType === "fixed" && input("deadline", t("fields.deadline"), { type: "datetime-local" }, t("hints.deadline"))}
          {input("startDate", t("fields.startDate"), { type: "datetime-local" })}
          {input("deadlineTimezone", t("fields.deadlineTimezone"), { placeholder: "Asia/Baku" })}
        </div>
      </Section>

      <Section title={t("sections.links")}>
        <div className="grid gap-5">
          {input("officialSourceUrl", t("fields.officialSourceUrl"), { type: "url", inputMode: "url", placeholder: "https://" }, t("hints.required"))}
          {input("applicationUrl", t("fields.applicationUrl"), { type: "url", inputMode: "url", placeholder: "https://" })}
        </div>
      </Section>

      <Section title={t("sections.translations")}>
        <p className="text-sm text-muted-foreground">{tTr("intro")}</p>
        <div className="space-y-5">
          {languages.map((lang) => {
            const k = (f: string) => `t_${lang.code}_${f}`;
            const stateNow = lang.state;
            return (
              <fieldset key={lang.code} className="rounded-xl border p-4" data-testid={`translation-${lang.code}`} data-state={stateNow}>
                <legend className="flex flex-wrap items-center gap-2 px-1 text-base font-semibold text-primary">
                  {lang.label}
                  {lang.original && <span className="rounded bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground">{tTr("originalTag")}</span>}
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground" data-testid={`translation-state-${lang.code}`}>
                    {stateLabel(stateNow)}
                  </span>
                </legend>
                {lang.original && <p className="mb-3 text-xs text-muted-foreground">{tTr("originalNote")}</p>}
                <div className="space-y-4">
                  {input(k("title"), tTr("fields.title"), { lang: lang.code })}
                  {!lang.original &&
                    field(k("status"), tTr("status"), (p) => (
                      <Select {...p} name={k("status")} defaultValue={str(values[k("status")]) || "human"}>
                        <option value="human">{tTr("statusOptions.human")}</option>
                        <option value="machine_draft">{tTr("statusOptions.machine_draft")}</option>
                      </Select>
                    ))}
                  {field(k("short"), tTr("fields.short"), (p) => <Textarea {...p} name={k("short")} defaultValue={str(values[k("short")])} lang={lang.code} rows={2} />)}
                  {field(k("description"), tTr("fields.description"), (p) => <Textarea {...p} name={k("description")} defaultValue={str(values[k("description")])} lang={lang.code} rows={4} />)}
                  {field(k("requirements"), tTr("fields.requirements"), (p) => <Textarea {...p} name={k("requirements")} defaultValue={str(values[k("requirements")])} lang={lang.code} rows={3} />)}
                  {field(k("benefits"), tTr("fields.benefits"), (p) => <Textarea {...p} name={k("benefits")} defaultValue={str(values[k("benefits")])} lang={lang.code} rows={3} />)}
                  {field(k("eligibility"), tTr("fields.eligibility"), (p) => <Textarea {...p} name={k("eligibility")} defaultValue={str(values[k("eligibility")])} lang={lang.code} rows={3} />)}
                </div>
                {id && !lang.original && (stateNow === "machine_draft" || stateNow === "machine_approved" || stateNow === "outdated") && (
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
                    {stateNow === "machine_draft" && (
                      <>
                        <Button type="button" size="sm" disabled={reviewing} data-action="approve" onClick={() => startReviewing(async () => { const r = await reviewTranslationAction(id, lang.code, "machine_approved"); setReviewError(r.ok ? null : tErr((r.code ?? "failed") as never)); })}>
                          {reviewing ? tTr("working") : tTr("approve")}
                        </Button>
                        <Button type="button" size="sm" variant="outline" disabled={reviewing} onClick={() => startReviewing(async () => { const r = await reviewTranslationAction(id, lang.code, "human"); setReviewError(r.ok ? null : tErr((r.code ?? "failed") as never)); })}>
                          {tTr("markReviewed")}
                        </Button>
                        <p className="w-full text-xs text-muted-foreground">{tTr("approveNote")}</p>
                      </>
                    )}
                    {stateNow === "machine_approved" && (
                      <Button type="button" size="sm" variant="outline" disabled={reviewing} onClick={() => startReviewing(async () => { const r = await reviewTranslationAction(id, lang.code, "machine_draft"); setReviewError(r.ok ? null : tErr((r.code ?? "failed") as never)); })}>
                        {tTr("backToDraft")}
                      </Button>
                    )}
                    {stateNow === "outdated" && (
                      <Button type="button" size="sm" variant="outline" disabled={reviewing} onClick={() => startReviewing(async () => { const r = await reviewTranslationAction(id, lang.code, "human"); setReviewError(r.ok ? null : tErr((r.code ?? "failed") as never)); })}>
                        {tTr("markReviewed")}
                      </Button>
                    )}
                  </div>
                )}
              </fieldset>
            );
          })}
        </div>
        {reviewError && (
          <p role="alert" className="text-sm text-destructive">
            {reviewError}
          </p>
        )}
      </Section>

      <div className="sm:max-w-xs">
        <Button type="submit" size="lg" className="w-full" disabled={pending} data-testid="save-opportunity">
          {pending ? t("saving") : mode === "create" ? t("create") : t("save")}
        </Button>
      </div>
    </form>
  );
}
