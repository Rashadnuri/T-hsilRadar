import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Container } from "@/components/layout/container";
import { DemoNotice } from "@/components/shared/demo-notice";
import { SectionHeading } from "@/components/shared/section-heading";
import { Button } from "@/components/ui/button";
import { OpportunityCard } from "@/features/opportunities/opportunity-card";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { OpportunityRecord } from "@/types/opportunity";

interface ShowcaseProps {
  id: string;
  title: string;
  description: string;
  items: OpportunityRecord[];
  locale: Locale;
  /** Catalogue query for the "view all" link. */
  query?: Record<string, string>;
  tinted?: boolean;
}

/** Reusable homepage band: heading, demo notice (when needed), card grid and a "view all" link. */
export async function OpportunityShowcase({ id, title, description, items, locale, query, tinted }: ShowcaseProps) {
  const t = await getTranslations("common");
  if (items.length === 0) return null;
  const hasDemo = items.some((o) => o.isDemo);

  return (
    <section aria-labelledby={id} className={tinted ? "border-y bg-surface py-16 sm:py-20" : "py-16 sm:py-20"}>
      <Container>
        <SectionHeading
          id={id}
          title={title}
          description={description}
          action={
            <Button asChild variant="outline">
              <Link href={{ pathname: "/opportunities", query }}>
                {t("viewAll")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          }
        />
        {hasDemo && <DemoNotice className="mt-6" />}
        <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((opportunity) => (
            <li key={opportunity.id}>
              <OpportunityCard opportunity={opportunity} locale={locale} />
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
