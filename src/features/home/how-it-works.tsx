import { Bookmark, Search, Sparkles } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Container } from "@/components/layout/container";
import { SectionHeading } from "@/components/shared/section-heading";

const steps = [
  { key: "search", icon: Search },
  { key: "track", icon: Bookmark },
  { key: "match", icon: Sparkles },
] as const;

export async function HowItWorks() {
  const [t, format] = await Promise.all([getTranslations("home"), getFormatter()]);
  return (
    <section aria-labelledby="how-heading" className="border-y bg-surface py-16 sm:py-20">
      <Container>
        <SectionHeading id="how-heading" title={t("how.title")} description={t("how.subtitle")} align="center" />
        <ol className="mt-10 grid gap-5 md:grid-cols-3">
          {steps.map(({ key, icon: Icon }, index) => (
            <li key={key} className="relative rounded-2xl border bg-card p-6 shadow-card">
              <div className="mb-5 flex items-center justify-between">
                <span className="grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground">
                  <Icon className="size-6" aria-hidden="true" />
                </span>
                <span aria-hidden="true" className="text-4xl font-bold text-secondary-foreground/15">
                  {format.number(index + 1)}
                </span>
              </div>
              <h3 className="text-lg font-semibold">{t(`how.steps.${key}.title`)}</h3>
              <p className="mt-2 text-muted-foreground">{t(`how.steps.${key}.text`)}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
