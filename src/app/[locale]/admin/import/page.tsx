import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AdminShell } from "@/features/admin/admin-shell";
import { ImportWorkflow } from "@/features/admin/import-workflow";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { requireAdmin } from "@/lib/auth/admin";
import { buildMetadata } from "@/lib/metadata";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "metadata" });
  return buildMetadata({ locale, path: "/admin/import", title: t("adminTitle"), description: t("adminDescription"), noindex: true });
}

export default async function Page({ params }: PageProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { admin } = await requireAdmin(locale, "/admin/import");
  const [batches, t, format] = await Promise.all([admin.importBatches(), getTranslations("admin.import"), getFormatter()]);

  return (
    <AdminShell title={t("title")} subtitle={t("subtitle")}>
      <ImportWorkflow />

      <section aria-labelledby="recent-heading" className="mt-12">
        <h2 id="recent-heading" className="text-xl font-semibold">
          {t("recent.title")}
        </h2>
        {batches.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed px-5 py-8 text-center text-muted-foreground" data-testid="batches-empty">
            {t("recent.empty")}
          </p>
        ) : (
          <ul className="mt-4 space-y-3" data-testid="batch-list">
            {batches.map((b) => (
              <li key={b.batch} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4 shadow-soft" data-testid="batch-item" data-batch={b.batch}>
                <div className="min-w-0">
                  <p className="font-semibold text-primary">{b.batch}</p>
                  <p className="text-sm text-muted-foreground">{t("recent.counts", { total: b.total, draft: b.draft, inReview: b.inReview, published: b.published })}</p>
                  <p className="text-xs text-muted-foreground">{format.dateTime(new Date(b.lastAt), { dateStyle: "medium", timeZone: "Asia/Baku" })}</p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href={{ pathname: "/admin/opportunities", query: { batch: b.batch } }}>{t("recent.open")}</Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AdminShell>
  );
}
