import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AdminShell } from "@/features/admin/admin-shell";
import { ExpireCheckButton } from "@/features/admin/expire-check-button";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { originalTitle } from "@/lib/admin/queries";
import { requireAdmin } from "@/lib/auth/admin";
import { buildMetadata } from "@/lib/metadata";
import type { AdminRepository } from "@/repositories/admin/types";
import type { OpportunityRecord } from "@/types/opportunity";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "metadata" });
  return buildMetadata({ locale, path: "/admin/quality", title: t("adminTitle"), description: t("adminDescription"), noindex: true });
}

/** Loads the records behind a list of ids (the report gives ids only; each list is capped at 100). */
async function recordsFor(admin: AdminRepository, ids: string[]): Promise<OpportunityRecord[]> {
  const found = await Promise.all(ids.slice(0, 25).map((id) => admin.get(id)));
  return found.flatMap((r) => (r ? [r] : []));
}

export default async function Page({ params }: PageProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { admin } = await requireAdmin(locale, "/admin/quality");

  const [report, sources, t, tOpen, format] = await Promise.all([admin.qualityReport(), admin.listSources(), getTranslations("admin.quality"), getTranslations("admin.sources"), getFormatter()]);
  const [expired, stale, missing] = await Promise.all([recordsFor(admin, report.expiredUnflagged), recordsFor(admin, report.staleVerification), recordsFor(admin, report.publishedMissingTranslations)]);
  const overdue = sources.filter((s) => report.sourcesOverdue.includes(s.id));
  const date = (iso: string | null) => (iso ? format.dateTime(new Date(iso), { dateStyle: "medium", timeZone: "Asia/Baku" }) : tOpen("never"));

  const list = (items: OpportunityRecord[], testId: string, empty: string, dateOf: (o: OpportunityRecord) => string | null) =>
    items.length === 0 ? (
      <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground" data-testid={`${testId}-empty`}>
        {empty}
      </p>
    ) : (
      <ul className="space-y-2" data-testid={testId}>
        {items.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
            <div className="min-w-0">
              <p className="font-medium text-primary">{originalTitle(o)}</p>
              <p className="text-xs text-muted-foreground">{`${o.organization.name} · ${date(dateOf(o))}`}</p>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href={`/admin/opportunities/${o.id}/edit`}>{t("open")}</Link>
            </Button>
          </li>
        ))}
      </ul>
    );

  return (
    <AdminShell title={t("title")} subtitle={t("subtitle")}>
      <p className="-mt-3 mb-6 max-w-3xl rounded-xl border bg-secondary px-4 py-3 text-sm text-primary" data-testid="never-assume">
        {t("never")}
      </p>
      <div className="space-y-10">
        <section aria-labelledby="expire-heading" className="space-y-3">
          <h2 id="expire-heading" className="text-xl font-semibold">
            {t("expire.title")}
          </h2>
          <p className="max-w-3xl text-sm text-muted-foreground">{t("expire.text")}</p>
          <ExpireCheckButton pending={report.expiredUnflagged.length} />
          {list(expired, "expired-list", t("expire.pending", { count: 0 }), (o) => o.applicationDeadline)}
        </section>

        <section aria-labelledby="stale-heading" className="space-y-3">
          <h2 id="stale-heading" className="text-xl font-semibold">
            {t("stale.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("stale.text")}</p>
          {list(stale, "stale-list", t("stale.empty"), (o) => o.lastVerifiedAt)}
        </section>

        <section aria-labelledby="sources-heading" className="space-y-3">
          <h2 id="sources-heading" className="text-xl font-semibold">
            {t("sources.title")}
          </h2>
          {overdue.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground" data-testid="overdue-sources-empty">
              {t("sources.empty")}
            </p>
          ) : (
            <ul className="space-y-2" data-testid="overdue-sources">
              {overdue.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3" data-name={s.organizationName}>
                  <div className="min-w-0">
                    <p className="font-medium text-primary">{s.organizationName}</p>
                    <p className="text-xs text-muted-foreground">{s.lastCheckedAt ? tOpen("lastChecked", { date: date(s.lastCheckedAt) }) : tOpen("never")}</p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href={{ pathname: "/admin/sources", query: { edit: s.id } }}>{t("open")}</Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="missing-heading" className="space-y-3">
          <h2 id="missing-heading" className="text-xl font-semibold">
            {t("missing.title")}
          </h2>
          {list(missing, "missing-list", t("missing.empty"), (o) => o.updatedAt)}
        </section>
        <p className="text-xs text-muted-foreground">{t("cappedNote")}</p>
      </div>
    </AdminShell>
  );
}
