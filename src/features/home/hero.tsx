import { ArrowRight, BadgeCheck, Globe2, Languages } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Container } from "@/components/layout/container";
import { Button } from "@/components/ui/button";
import { SearchBar } from "@/features/opportunities/search-bar";
import { Link } from "@/i18n/navigation";
import type { OpportunityType } from "@/types/opportunity";

const popular: OpportunityType[] = ["scholarship", "internship", "exchange", "training"];

/** Decorative radar graphic: purely abstract (no data), hidden from assistive tech. */
function RadarGraphic() {
  return (
    <svg viewBox="0 0 400 400" aria-hidden="true" className="h-full w-full">
      <defs>
        <radialGradient id="radar-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2563eb" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="radar-sweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#2563eb" stopOpacity="0" />
          <stop offset="100%" stopColor="#2563eb" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      <circle cx="200" cy="200" r="190" fill="url(#radar-glow)" />
      {[60, 110, 160, 190].map((r) => (
        <circle key={r} cx="200" cy="200" r={r} fill="none" stroke="#0f2557" strokeOpacity="0.12" />
      ))}
      <path d="M200 200 L390 200 A190 190 0 0 0 335 65 Z" fill="url(#radar-sweep)" />
      <line x1="10" y1="200" x2="390" y2="200" stroke="#0f2557" strokeOpacity="0.1" />
      <line x1="200" y1="10" x2="200" y2="390" stroke="#0f2557" strokeOpacity="0.1" />
      <circle cx="200" cy="200" r="7" fill="#0f2557" />
      <circle cx="285" cy="118" r="6" fill="#2563eb" />
      <circle cx="132" cy="262" r="5" fill="#2563eb" fillOpacity="0.7" />
      <circle cx="262" cy="288" r="4" fill="#0f2557" fillOpacity="0.5" />
      <circle cx="318" cy="205" r="4" fill="#2563eb" fillOpacity="0.5" />
    </svg>
  );
}

export async function Hero() {
  const t = await getTranslations("home");
  const tType = await getTranslations("opportunityTypes");

  return (
    <section className="relative overflow-hidden border-b bg-gradient-to-b from-secondary via-background to-background">
      <Container className="relative grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:py-24">
        <div className="min-w-0">
          <p className="mb-5 inline-flex max-w-full items-center gap-2 rounded-full border bg-background px-3 py-1 text-sm font-medium text-primary shadow-soft">
            <span className="size-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
            {t("hero.badge")}
          </p>
          <h1 className="text-4xl font-bold sm:text-5xl lg:text-[3.4rem] lg:leading-[1.1]">{t("hero.title")}</h1>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">{t("hero.subtitle")}</p>

          <SearchBar standalone size="large" className="mt-8 max-w-2xl" />

          <div className="mt-5 flex max-w-2xl flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">{t("hero.popular")}</span>
            {popular.map((code) => (
              <Link
                key={code}
                href={{ pathname: "/opportunities", query: { type: code } }}
                className="inline-flex min-h-9 items-center rounded-full border bg-background px-3 text-sm font-medium text-primary transition-colors hover:border-accent hover:bg-secondary"
              >
                {tType(code)}
              </Link>
            ))}
          </div>

          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium text-primary">
            {[
              { icon: BadgeCheck, text: t("hero.points.source") },
              { icon: Globe2, text: t("hero.points.markets") },
              { icon: Languages, text: t("hero.points.languages") },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-2">
                <Icon className="size-4 text-accent" aria-hidden="true" />
                {text}
              </li>
            ))}
          </ul>

          <div className="mt-8 sm:hidden">
            <Button asChild variant="outline" size="lg" className="w-full">
              <Link href="/about">
                {t("hero.secondaryCta")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>

        <div className="mx-auto hidden aspect-square w-full max-w-md lg:block">
          <RadarGraphic />
        </div>
      </Container>
    </section>
  );
}
