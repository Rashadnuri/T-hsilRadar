import { getTranslations } from "next-intl/server";
import { Container } from "@/components/layout/container";
import { SectionHeading } from "@/components/shared/section-heading";
import { CategoryCard } from "@/features/categories/category-card";
import { OPPORTUNITY_TYPES } from "@/types/opportunity";

export async function CategorySection() {
  const t = await getTranslations("home");
  return (
    <section aria-labelledby="categories-heading" className="py-16 sm:py-20">
      <Container>
        <SectionHeading id="categories-heading" title={t("categories.title")} description={t("categories.subtitle", { count: OPPORTUNITY_TYPES.length })} />
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {OPPORTUNITY_TYPES.map((code) => (
            <li key={code}>
              <CategoryCard code={code} />
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
