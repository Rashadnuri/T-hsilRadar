import { getTranslations } from "next-intl/server";
import { Container } from "@/components/layout/container";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

export async function CtaSection() {
  const t = await getTranslations("home");
  return (
    <section aria-labelledby="cta-heading" className="pb-16 sm:pb-20">
      <Container>
        <div className="relative overflow-hidden rounded-3xl bg-primary px-6 py-12 text-primary-foreground shadow-card-hover sm:px-12 sm:py-16">
          <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 size-72 rounded-full bg-accent/30 blur-3xl" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 left-1/3 size-72 rounded-full bg-white/5 blur-2xl" />
          <div className="relative mx-auto max-w-2xl text-center">
            <h2 id="cta-heading" className="text-2xl font-bold !text-primary-foreground sm:text-4xl">
              {t("cta.title")}
            </h2>
            <p className="mt-4 text-lg text-primary-foreground/80">{t("cta.text")}</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" variant="accent">
                <Link href="/register">{t("cta.primary")}</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/30 bg-transparent text-primary-foreground hover:bg-white/10 hover:text-primary-foreground">
                <Link href="/opportunities">{t("cta.secondary")}</Link>
              </Button>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
