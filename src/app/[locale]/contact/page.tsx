import type { Metadata } from "next";
import { Handshake, LifeBuoy, Mail, MessagesSquare, type LucideIcon } from "lucide-react";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Container } from "@/components/layout/container";
import { SectionHeading } from "@/components/shared/section-heading";
import { Button } from "@/components/ui/button";
import { ContactForm, contactTopics } from "@/features/contact/contact-form";
import { routing } from "@/i18n/routing";
import { getContactEmail, mailtoHref } from "@/lib/contact";
import { buildMetadata } from "@/lib/metadata";

interface PageProps {
  params: Promise<{ locale: string }>;
}

const topicIcons: Record<(typeof contactTopics)[number], LucideIcon> = {
  general: MessagesSquare,
  partnership: Handshake,
  report: LifeBuoy,
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "metadata" });
  return buildMetadata({ locale, path: "/contact", title: t("contactTitle"), description: t("contactDescription") });
}

export default async function ContactPage({ params }: PageProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("contact");
  // Set by the operator (NEXT_PUBLIC_CONTACT_EMAIL). Without it the page keeps its honest "not active yet" form notice.
  const email = getContactEmail();

  return (
    <>
      <section className="border-b bg-gradient-to-b from-secondary to-background">
        <Container className="py-10 sm:py-14">
          <SectionHeading as="h1" title={t("title")} description={t("subtitle")} />
        </Container>
      </section>
      <Container className="grid gap-8 py-10 sm:py-14 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <section aria-labelledby="topics-heading">
          <h2 id="topics-heading" className="sr-only">
            {t("topicsTitle")}
          </h2>
          <ul className="space-y-4">
            {contactTopics.map((topic) => {
              const Icon = topicIcons[topic];
              return (
                <li key={topic} className="flex gap-4 rounded-2xl border bg-card p-5 shadow-card">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-secondary text-accent">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-semibold">{t(`topics.${topic}.title`)}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{t(`topics.${topic}.text`)}</p>
                    {email && (
                      <a href={mailtoHref(email, t(`topics.${topic}.subject`))} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline">
                        {t("mail.topicCta")}
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-6 text-sm text-muted-foreground">{email ? t("mailNote") : t("detailsNote")}</p>
        </section>
        {email ? (
          <section aria-labelledby="mail-heading" className="self-start rounded-3xl border bg-card p-6 shadow-card sm:p-8" data-testid="contact-mail">
            <h2 id="mail-heading" className="text-xl font-semibold">
              {t("mail.title")}
            </h2>
            <p className="mt-3 text-muted-foreground">{t("mail.text")}</p>
            <p className="mt-5 break-all text-lg font-semibold">{email}</p>
            <Button asChild size="lg" className="mt-4 w-full sm:w-auto">
              <a href={mailtoHref(email, t("topics.general.subject"))}>
                <Mail aria-hidden="true" />
                {t("mail.cta")}
              </a>
            </Button>
            <p className="mt-5 text-sm text-muted-foreground">{t("mail.reportHint")}</p>
          </section>
        ) : (
          <ContactForm />
        )}
      </Container>
    </>
  );
}
