import { Bookmark, ClipboardList, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Container } from "@/components/layout/container";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { ApplicationEditor } from "@/features/plan/application-editor";
import { PlanItemSummary } from "@/features/plan/plan-item-summary";
import { buildPlanView, filterByStatus, type PlanItem } from "@/features/plan/plan-view";
import { SavedItemActions } from "@/features/plan/saved-item-actions";
import { Link } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { getAuthContext, requireUser } from "@/lib/auth/session";
import { resolveContent } from "@/lib/opportunities/translations";
import { buildMetadata } from "@/lib/metadata";
import { cn } from "@/lib/utils";
import { getOpportunitiesByIds } from "@/services/opportunities";
import { APPLICATION_STATUSES, isApplicationStatus } from "@/types/plan";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string | string[] }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "metadata" });
  // Private page: never indexed.
  return buildMetadata({ locale, path: "/my-plan", title: t("myPlanTitle"), description: t("myPlanDescription"), noindex: true });
}

function itemClasses(item: PlanItem) {
  return cn("rounded-2xl border p-5 sm:p-6", item.state === "expired" || !item.record ? "border-dashed bg-muted/50" : "bg-card shadow-card");
}

export default async function Page({ params, searchParams }: PageProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  // Authoritative check; the proxy only does an optimistic redirect.
  const user = await requireUser(locale, "/my-plan");
  const { plan } = await getAuthContext();
  const t = await getTranslations("plan");
  const tStatus = await getTranslations("plan.status");
  const format = await getFormatter();
  const tNav = await getTranslations("nav");

  const raw = (await searchParams).status;
  const requested = Array.isArray(raw) ? raw[0] : raw;
  const statusFilter = isApplicationStatus(requested) ? requested : null;

  // Only the verified session user's own rows (and RLS enforces the same in the database).
  const [saved, applications] = plan ? await Promise.all([plan.listSaved(user.id), plan.listApplications(user.id)]) : [[], []];
  const records = await getOpportunitiesByIds([...new Set([...saved, ...applications].map((r) => r.opportunityId))]);
  const view = buildPlanView(saved, applications, records);
  const visibleApplications = filterByStatus(view.applications, statusFilter);
  const titleOf = (item: PlanItem) => (item.record ? resolveContent(item.record, locale as Locale).title.value : "");

  const stats = [
    { key: "applications", value: view.stats.applications },
    { key: "saved", value: view.stats.saved },
    { key: "closingSoon", value: view.stats.closingSoon },
    { key: "expired", value: view.stats.expired },
  ] as const;

  return (
    <Container className="py-10 sm:py-14">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("subtitle")}</p>
        <p className="mt-4 flex items-start gap-2.5 rounded-xl border bg-secondary px-3.5 py-3 text-sm text-primary">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          {t("privacy")}
        </p>

        <p className="mt-4">
          <Link href="/matches" className="inline-flex min-h-9 items-center font-semibold text-accent hover:underline">
            {tNav("matches")}
          </Link>
        </p>

        <dl aria-label={t("stats.label")} className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map(({ key, value }) => (
            <div key={key} className="rounded-2xl border bg-card p-4 shadow-soft">
              <dt className="text-xs font-medium text-muted-foreground">{t(`stats.${key}`)}</dt>
              <dd className="mt-1 text-2xl font-bold text-primary" data-testid={`stat-${key}`}>
                {value}
              </dd>
            </div>
          ))}
        </dl>

        <section aria-labelledby="applications-heading" className="mt-10">
          <h2 id="applications-heading" className="text-2xl font-bold">
            {t("sections.applications")}
          </h2>

          {view.applications.length > 0 && (
            <nav aria-label={t("filter.label")} className="mt-4">
              <ul className="flex flex-wrap gap-2">
                {[null, ...APPLICATION_STATUSES].map((status) => {
                  const current = status === statusFilter;
                  return (
                    <li key={status ?? "all"}>
                      <Link
                        href={status ? { pathname: "/my-plan", query: { status } } : "/my-plan"}
                        aria-current={current ? "true" : undefined}
                        className={cn(
                          "inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-medium transition-colors",
                          current ? "border-primary bg-primary text-primary-foreground" : "bg-background text-primary hover:bg-secondary",
                        )}
                      >
                        {status ? tStatus(status) : t("filter.all")}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}

          <div className="mt-5">
            {view.applications.length === 0 ? (
              <EmptyState icon={ClipboardList} title={t("empty.applications.title")} description={t("empty.applications.text")}>
                <Button asChild>
                  <Link href="/opportunities">{t("empty.browse")}</Link>
                </Button>
              </EmptyState>
            ) : visibleApplications.length === 0 ? (
              <p className="rounded-2xl border border-dashed px-5 py-8 text-center text-muted-foreground">{t("empty.filtered")}</p>
            ) : (
              <ul className="space-y-4" data-testid="applications-list">
                {visibleApplications.map((item) => (
                  <li key={item.opportunityId} className={itemClasses(item)} data-testid="application-item" data-expired={item.state === "expired" ? "true" : undefined}>
                    <PlanItemSummary item={item} locale={locale as Locale} />
                    {item.application && (
                      <ApplicationEditor
                        opportunityId={item.opportunityId}
                        initialStatus={item.application.status}
                        initialNotes={item.application.notes}
                        updatedText={format.dateTime(new Date(item.application.updatedAt), { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Baku" })}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section aria-labelledby="saved-heading" className="mt-12">
          <h2 id="saved-heading" className="text-2xl font-bold">
            {t("sections.saved")}
          </h2>
          <div className="mt-5">
            {view.saved.length === 0 ? (
              <EmptyState icon={Bookmark} title={t("empty.saved.title")} description={t("empty.saved.text")}>
                <Button asChild>
                  <Link href="/opportunities">{t("empty.browse")}</Link>
                </Button>
              </EmptyState>
            ) : (
              <ul className="space-y-4" data-testid="saved-list">
                {view.saved.map((item) => (
                  <li key={item.opportunityId} className={itemClasses(item)} data-testid="saved-item" data-expired={item.state === "expired" ? "true" : undefined}>
                    <PlanItemSummary item={item} locale={locale as Locale} />
                    <SavedItemActions
                      opportunityId={item.opportunityId}
                      title={titleOf(item)}
                      trackedStatus={item.application?.status ?? null}
                      canTrack={item.record !== null}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </Container>
  );
}
