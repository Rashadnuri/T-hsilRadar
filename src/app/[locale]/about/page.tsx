import type { Metadata } from "next";
import { GraduationCap, Briefcase, Building2 } from "lucide-react";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Container } from "@/components/layout/container";
import { SectionHeading } from "@/components/shared/section-heading";
import { Button } from "@/components/ui/button";
import { PrincipleList } from "@/features/home/principles";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { buildMetadata } from "@/lib/metadata";

interface PageProps {
  params: Promise<{ locale: string }>;
}

const audiences = [
  { key: "students", icon: GraduationCap },
  { key: "professionals", icon: Briefcase },
  { key: "organizations", icon: Building2 },
] as const;
const verifySteps = ["source", "organization", "deadline", "review"] as const;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "metadata" });
  return buildMetadata({ locale, path: "/about", title: t("aboutTitle"), description: t("aboutDescription") });
}

export default async function AboutPage({ params }: PageProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const [t, format] = await Promise.all([getTranslations("about"), getFormatter()]);

  return (
    <>
      <section className="border-b bg-gradient-to-b from-secondary to-background">
        <Container className="py-12 sm:py-16">
          <div className="max-w-3xl">
            <h1 className="text-4xl font-bold sm:text-5xl">{t("title")}</h1>
            <p className="mt-5 text-lg text-muted-foreground">{t("intro")}</p>
            <p className="mt-4 text-muted-foreground">{t("mission")}</p>
          </div>
        </Container>
      </section>

      <section aria-labelledby="audience-heading" className="py-14 sm:py-16">
        <Container>
          <SectionHeading id="audience-heading" title={t("audience.title")} description={t("audience.subtitle")} />
          <ul className="mt-8 grid gap-5 md:grid-cols-3">
            {audiences.map(({ key, icon: Icon }) => (
              <li key={key} className="rounded-2xl border bg-card p-6 shadow-card">
                <span className="mb-4 grid size-11 place-items-center rounded-xl bg-secondary text-accent">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="text-lg font-semibold">{t(`audience.${key}.title`)}</h3>
                <p className="mt-2 text-muted-foreground">{t(`audience.${key}.text`)}</p>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section aria-labelledby="verify-heading" className="border-y bg-surface py-14 sm:py-16">
        <Container>
          <SectionHeading id="verify-heading" title={t("verify.title")} description={t("verify.subtitle")} />
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {verifySteps.map((step, index) => (
              <li key={step} className="rounded-2xl border bg-card p-5 shadow-card">
                <span className="mb-3 grid size-9 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {format.number(index + 1)}
                </span>
                <h3 className="font-semibold">{t(`verify.steps.${step}.title`)}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{t(`verify.steps.${step}.text`)}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section aria-labelledby="principles-heading" className="py-14 sm:py-16">
        <Container>
          <SectionHeading id="principles-heading" title={t("principles.title")} description={t("principles.subtitle")} />
          <div className="mt-8">
            <PrincipleList />
          </div>
          <p className="mt-8 rounded-xl border-l-4 border-accent bg-secondary px-4 py-3 text-sm text-primary">{t("status")}</p>
        </Container>
      </section>

      <section aria-labelledby="about-cta-heading" className="pb-16">
        <Container>
          <div className="flex flex-col items-start justify-between gap-6 rounded-3xl border bg-card p-8 shadow-card sm:flex-row sm:items-center">
            <div className="min-w-0 max-w-xl">
              <h2 id="about-cta-heading" className="text-2xl font-bold">
                {t("cta.title")}
              </h2>
              <p className="mt-2 text-muted-foreground">{t("cta.text")}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/opportunities">{t("cta.primary")}</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/contact">{t("cta.secondary")}</Link>
              </Button>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
