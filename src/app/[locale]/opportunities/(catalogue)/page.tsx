import type { Metadata } from "next";
import { SearchX } from "lucide-react";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { CleanGetForm } from "@/components/forms/clean-get-form";
import { Container } from "@/components/layout/container";
import { DemoNotice } from "@/components/shared/demo-notice";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionHeading } from "@/components/shared/section-heading";
import { Button } from "@/components/ui/button";
import { ActiveFilters } from "@/features/opportunities/active-filters";
import { FilterPanel } from "@/features/opportunities/filter-panel";
import { OpportunityCard } from "@/features/opportunities/opportunity-card";
import { Pagination } from "@/features/opportunities/pagination";
import { AzerbaijanPanel } from "@/features/opportunities/azerbaijan-panel";
import { CatalogueMemory } from "@/features/opportunities/catalogue-memory";
import { buildFilterOptions } from "@/features/opportunities/filter-options";
import { ScopeTabs } from "@/features/opportunities/scope-tabs";
import { SearchBar } from "@/features/opportunities/search-bar";
import { SortSelect } from "@/features/opportunities/sort-select";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { buildMetadata } from "@/lib/metadata";
import { defaultSort } from "@/lib/opportunities/search";
import { getCatalogueFacets, listOpportunities } from "@/services/opportunities";
import { PANEL_FILTER_KEYS, FILTER_KEYS, parseOpportunityFilters } from "@/validation/opportunity-filters";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "metadata" });
  const raw = await searchParams;
  const { page } = parseOpportunityFilters(raw);
  // Filter and search views canonicalise to the plain catalogue (they are views of the same list); a
  // paginated list WITHOUT filters is its own page: self-canonical, with its own title.
  const onlyPaging = Object.keys(raw).every((key) => key === "page");
  const paged = onlyPaging && page > 1;
  return buildMetadata({
    locale,
    path: paged ? `/opportunities?page=${page}` : "/opportunities",
    title: paged ? t("opportunitiesPageTitle", { title: t("opportunitiesTitle"), page }) : t("opportunitiesTitle"),
    description: t("opportunitiesDescription"),
  });
}

export default async function OpportunitiesPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const filters = parseOpportunityFilters(await searchParams);
  const [t, result, facets, options] = await Promise.all([
    getTranslations("catalogue"),
    listOpportunities(filters),
    getCatalogueFacets(filters),
    buildFilterOptions(locale),
  ]);
  const activeCount = PANEL_FILTER_KEYS.filter((key) => filters[key]).length;
  const hasAnyFilter = FILTER_KEYS.some((key) => filters[key]);
  const sort = filters.sort ?? defaultSort(filters.q);
  const hasDemo = result.items.some((o) => o.isDemo);

  return (
    <>
      <section className="border-b bg-gradient-to-b from-secondary to-background">
        <Container className="py-10 sm:py-14">
          <SectionHeading as="h1" title={t("title")} description={t("subtitle")} />
        </Container>
      </section>

      <Container className="py-8 sm:py-10">
        <CatalogueMemory />
        {/* Re-mounted when the URL changes so uncontrolled fields always show the applied values. */}
        <CleanGetForm key={JSON.stringify(filters)} className="space-y-6">
          <SearchBar defaultValue={filters.q} />

          <div className="space-y-4">
            <ScopeTabs filters={filters} facets={facets} />
            {filters.scope === "azerbaijan" && <AzerbaijanPanel filters={filters} facets={facets} />}
          </div>

          <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start xl:grid-cols-[18rem_minmax(0,1fr)]">
            <FilterPanel values={filters} activeCount={activeCount} countries={options.countries} cityGroups={options.cityGroups} />

            {/* Dims while a new result set is loading (form[data-pending]). */}
            <section
              aria-labelledby="results-heading"
              className="min-w-0 space-y-5 transition-opacity duration-150 group-data-[pending=true]:opacity-50"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 id="results-heading" aria-live="polite" className="text-base font-semibold">
                  {t("results", { count: result.total })}
                </h2>
                <SortSelect value={sort} hasQuery={Boolean(filters.q)} />
              </div>

              {hasAnyFilter && <ActiveFilters filters={filters} />}
              {hasDemo && <DemoNotice />}

              {result.items.length === 0 ? (
                <EmptyState
                  icon={SearchX}
                  title={hasAnyFilter ? t("empty.filteredTitle") : t("empty.title")}
                  description={hasAnyFilter ? `${t("empty.filteredText")} ${t("empty.suggestion")}` : t("empty.text")}
                >
                  {hasAnyFilter ? (
                    <Button asChild>
                      <Link href="/opportunities">{t("empty.reset")}</Link>
                    </Button>
                  ) : (
                    <Button asChild variant="outline">
                      <Link href="/about">{t("empty.about")}</Link>
                    </Button>
                  )}
                </EmptyState>
              ) : (
                <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  {result.items.map((opportunity) => (
                    <li key={opportunity.id}>
                      <OpportunityCard opportunity={opportunity} locale={locale} />
                    </li>
                  ))}
                </ul>
              )}

              <Pagination page={result.page} totalPages={result.totalPages} filters={filters} />
            </section>
          </div>
        </CleanGetForm>
      </Container>
    </>
  );
}
