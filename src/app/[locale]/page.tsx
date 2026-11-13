import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/seo/json-ld";
import { CategorySection } from "@/features/home/category-section";
import { CtaSection } from "@/features/home/cta-section";
import { Hero } from "@/features/home/hero";
import { HowItWorks } from "@/features/home/how-it-works";
import { OpportunityShowcase } from "@/features/home/opportunity-showcase";
import { TrustSection } from "@/features/home/trust-section";
import { routing } from "@/i18n/routing";
import { absoluteUrl, SITE_NAME } from "@/lib/site";
import { getHomepageGroups } from "@/services/opportunities";

// Deadlines are time-sensitive: regenerate every 10 minutes (ARCHITECTURE.md §4).
export const revalidate = 600;

// Metadata (title, description, canonical, hreflang) is inherited from the locale layout.
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const [t, groups] = await Promise.all([getTranslations("home"), getHomepageGroups(3)]);

  return (
    <>
      <JsonLd data={{ "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: absoluteUrl(locale), inLanguage: locale }} />
      <Hero />
      <CategorySection />
      <OpportunityShowcase
        id="featured-heading"
        title={t("featured.title")}
        description={t("featured.subtitle")}
        items={groups.featured}
        locale={locale}
        tinted
      />
      <OpportunityShowcase
        id="azerbaijan-heading"
        title={t("azerbaijan.title")}
        description={t("azerbaijan.subtitle")}
        items={groups.azerbaijan}
        locale={locale}
        query={{ scope: "azerbaijan" }}
      />
      <OpportunityShowcase
        id="international-heading"
        title={t("international.title")}
        description={t("international.subtitle")}
        items={groups.international}
        locale={locale}
        query={{ scope: "international" }}
        tinted
      />
      <HowItWorks />
      <TrustSection />
      <CtaSection />
    </>
  );
}
