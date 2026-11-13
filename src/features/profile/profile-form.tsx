"use client";

import { useActionState, useState, useTransition, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { saveProfileAction } from "@/features/auth/actions";
import { ErrorText, FocusFirstError, FormAlert, SubmitButton, useFieldErrorText } from "@/features/auth/form-parts";
import { initialFormState } from "@/features/auth/state";
import { EDUCATION_LEVELS, FIELDS_OF_STUDY, OPPORTUNITY_TYPES, type OpportunityType } from "@/types/opportunity";
import { PROFILE_LIMITS, type ProfileInput } from "@/types/profile";
import { CountryPicker, LanguageRows, TagInput, type LanguageRow } from "./profile-fields";

interface Option {
  value: string;
  label: string;
}

interface ProfileFormProps {
  initial: ProfileInput;
  countries: Option[];
  languages: Option[];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-5 rounded-2xl border bg-card p-5 shadow-soft sm:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function ProfileForm({ initial, countries, languages }: ProfileFormProps) {
  const t = useTranslations("profile");
  const tLevel = useTranslations("level");
  const tField = useTranslations("fields");
  const tType = useTranslations("opportunityTypes");
  const text = useFieldErrorText();
  const [state, action, pendingAction] = useActionState(saveProfileAction, initialFormState);
  const [submitting, startSubmitting] = useTransition();
  const pending = pendingAction || submitting;

  // Controlled state: what the visitor typed survives a failed save (React resets plain forms after an action).
  const [fullName, setFullName] = useState(initial.fullName ?? "");
  const [educationLevel, setEducationLevel] = useState<string>(initial.educationLevel ?? "");
  const [university, setUniversity] = useState(initial.university ?? "");
  const [academicField, setAcademicField] = useState<string>(initial.academicField ?? "");
  const [graduationYear, setGraduationYear] = useState(initial.graduationYear?.toString() ?? "");
  const [country, setCountry] = useState(initial.countryOfResidence ?? "");
  const [preferredCountries, setPreferredCountries] = useState(initial.preferredCountries);
  const [skills, setSkills] = useState(initial.skills);
  const [careerInterests, setCareerInterests] = useState(initial.careerInterests);
  const [rows, setRows] = useState<LanguageRow[]>(initial.languages.map((l) => ({ code: l.code, level: l.level })));
  const [types, setTypes] = useState<OpportunityType[]>(initial.preferredOpportunityTypes);

  const e = state.fieldErrors ?? {};
  const toggleType = (type: OpportunityType) => setTypes((current) => (current.includes(type) ? current.filter((x) => x !== type) : [...current, type]));

  // Not `<form action>`: React resets the form after an action, which snaps the controlled selects back to their initial value.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startSubmitting(() => action(data));
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <FocusFirstError trigger={state} />
      <FormAlert state={state} />
      {state.status === "success" && state.message === "saved" && (
        <p role="status" className="flex items-start gap-2.5 rounded-xl border border-accent/25 bg-secondary px-3.5 py-3 text-sm text-primary">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          {t("saved")}
        </p>
      )}

      <Section title={t("sections.about")}>
        <div>
          <Field label={t("fields.fullName")}>
            {(p) => <Input {...p} name="fullName" autoComplete="name" value={fullName} onChange={(ev) => setFullName(ev.target.value)} aria-invalid={!!e.fullName} />}
          </Field>
          <ErrorText id="profile-name-err" message={text(e.fullName)} />
        </div>
        <div>
          <Field label={t("fields.countryOfResidence")}>
            {(p) => (
              <Select {...p} name="countryOfResidence" value={country} onChange={(ev) => setCountry(ev.target.value)} aria-invalid={!!e.countryOfResidence}>
                <option value="">{t("choose")}</option>
                {countries.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <ErrorText id="profile-country-err" message={text(e.countryOfResidence)} />
        </div>
      </Section>

      <Section title={t("sections.education")}>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Field label={t("fields.educationLevel")}>
              {(p) => (
                <Select {...p} name="educationLevel" value={educationLevel} onChange={(ev) => setEducationLevel(ev.target.value)}>
                  <option value="">{t("choose")}</option>
                  {EDUCATION_LEVELS.map((v) => (
                    <option key={v} value={v}>
                      {tLevel(v)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <ErrorText id="profile-level-err" message={text(e.educationLevel)} />
          </div>
          <div>
            <Field label={t("fields.academicField")}>
              {(p) => (
                <Select {...p} name="academicField" value={academicField} onChange={(ev) => setAcademicField(ev.target.value)}>
                  <option value="">{t("choose")}</option>
                  {FIELDS_OF_STUDY.map((v) => (
                    <option key={v} value={v}>
                      {tField(v)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <ErrorText id="profile-field-err" message={text(e.academicField)} />
          </div>
          <div>
            <Field label={t("fields.university")}>
              {(p) => <Input {...p} name="university" value={university} maxLength={PROFILE_LIMITS.universityMax + 20} onChange={(ev) => setUniversity(ev.target.value)} />}
            </Field>
            <ErrorText id="profile-university-err" message={text(e.university)} />
          </div>
          <div>
            <Field label={t("fields.graduationYear")}>
              {(p) => <Input {...p} name="graduationYear" inputMode="numeric" value={graduationYear} onChange={(ev) => setGraduationYear(ev.target.value)} aria-invalid={!!e.graduationYear} />}
            </Field>
            <ErrorText id="profile-year-err" message={text(e.graduationYear)} />
          </div>
        </div>
      </Section>

      <Section title={t("sections.skills")}>
        <TagInput
          name="skills"
          label={t("fields.skills")}
          hint={t("hints.skills", { max: PROFILE_LIMITS.skillsMax })}
          values={skills}
          onChange={setSkills}
          max={PROFILE_LIMITS.skillsMax}
          maxLength={PROFILE_LIMITS.skillMax}
          error={text(e.skills)}
        />
        <LanguageRows label={t("fields.languages")} options={languages} rows={rows} onChange={setRows} max={PROFILE_LIMITS.languagesMax} error={text(e.languages)} />
      </Section>

      <Section title={t("sections.preferences")}>
        <CountryPicker
          name="preferredCountries"
          label={t("fields.preferredCountries")}
          hint={t("hints.preferredCountries", { max: PROFILE_LIMITS.countriesMax })}
          options={countries}
          values={preferredCountries}
          onChange={setPreferredCountries}
          max={PROFILE_LIMITS.countriesMax}
          placeholder={t("choose")}
          error={text(e.preferredCountries)}
        />
        <TagInput
          name="careerInterests"
          label={t("fields.careerInterests")}
          hint={t("hints.careerInterests", { max: PROFILE_LIMITS.interestsMax })}
          values={careerInterests}
          onChange={setCareerInterests}
          max={PROFILE_LIMITS.interestsMax}
          maxLength={PROFILE_LIMITS.interestMax}
          error={text(e.careerInterests)}
        />
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-primary">{t("fields.preferredTypes")}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {OPPORTUNITY_TYPES.map((type) => (
              <Label key={type} className="mb-0 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-background px-3 py-2 font-normal hover:bg-secondary">
                <input type="checkbox" name="preferredTypes" value={type} checked={types.includes(type)} onChange={() => toggleType(type)} className="size-4 accent-[var(--accent)]" />
                {tType(type)}
              </Label>
            ))}
          </div>
          <ErrorText id="profile-types-err" message={text(e.preferredOpportunityTypes)} />
        </fieldset>
      </Section>

      <div className="sm:max-w-xs">
        <SubmitButton pending={pending} pendingLabel={t("saving")}>
          {t("save")}
        </SubmitButton>
      </div>
    </form>
  );
}
