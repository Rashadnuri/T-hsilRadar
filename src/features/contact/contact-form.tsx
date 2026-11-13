import { Info } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { InactiveForm } from "@/components/forms/inactive-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export const contactTopics = ["general", "partnership", "report"] as const;

/** Layout-only: the form never submits (no backend yet) and says so. */
export async function ContactForm() {
  const t = await getTranslations("contact");
  return (
    <div className="rounded-3xl border bg-card p-6 shadow-card sm:p-8">
      <h2 className="text-xl font-semibold">{t("form.title")}</h2>
      <p role="note" className="mt-4 flex items-start gap-2.5 rounded-xl border border-accent/25 bg-secondary px-3.5 py-3 text-sm text-primary">
        <Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
        {t("form.notice")}
      </p>
      <InactiveForm className="mt-6 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("form.name")}>{(p) => <Input {...p} name="name" autoComplete="name" />}</Field>
          <Field label={t("form.email")}>
            {(p) => <Input {...p} name="email" type="email" autoComplete="email" inputMode="email" />}
          </Field>
        </div>
        <Field label={t("form.topic")}>
          {(p) => (
            <Select {...p} name="topic" defaultValue="general">
              {contactTopics.map((topic) => (
                <option key={topic} value={topic}>
                  {t(`topics.${topic}.title`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("form.message")}>{(p) => <Textarea {...p} name="message" rows={6} />}</Field>
        <Button type="submit" size="lg" className="w-full sm:w-auto" disabled>
          {t("form.submit")}
        </Button>
      </InactiveForm>
    </div>
  );
}
