import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdminShell } from "@/features/admin/admin-shell";
import { TranslationCoverage } from "@/features/admin/coverage";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { originalTitle } from "@/lib/admin/queries";
import { requireAdmin } from "@/lib/auth/admin";
import { buildMetadata } from "@/lib/metadata";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "metadata" });
  return buildMetadata({ locale, path: "/admin", title: t("adminTitle"), description: t("adminDescription"), noindex: true });
}

export default async function Page({ params }: PageProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  // Authoritative server-side check: signed in AND holding the admin role (anyone else gets a 404).
  const { admin } = await requireAdmin(locale, "/admin");

  const [stats, pending] = await Promise.all([admin.stats(), admin.list({ status: "in_review", page: 1 })]);
  const t = await getTranslations("admin");
  const format = await getFormatter();

  const cards: { key: string; value: number; href: string }[] = [
    { key: "total", value: stats.total, href: "/admin/opportunities" },
    { key: "pending", value: stats.byStatus.in_review ?? 0, href: "/admin/opportunities?status=in_review" },
    { key: "published", value: stats.byStatus.published ?? 0, href: "/admin/opportunities?status=published" },
    { key: "draft", value: stats.byStatus.draft ?? 0, href: "/admin/opportunities?status=draft" },
    { key: "rejected", value: stats.byStatus.rejected ?? 0, href: "/admin/opportunities?status=rejected" },
    { key: "archived", value: stats.byStatus.archived ?? 0, href: "/admin/opportunities?status=archived" },
    { key: "unverified", value: stats.unverified, href: "/admin/opportunities?verification=unverified" },
    { key: "expired", value: stats.expired, href: "/admin/opportunities?expired=1" },
    { key: "missingTranslations", value: stats.missingTranslations, href: "/admin/opportunities" },
    { key: "organizations", value: stats.organizations, href: "/admin/organizations" },
  ];

  return (
    <AdminShell
      title={t("title")}
      subtitle={t("dashboard.subtitle")}
      actions={
        <Button asChild>
          <Link href="/admin/opportunities/new">{t("dashboard.actions.new")}</Link>
        </Button>
      }
    >
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="stats">
        {cards.map(({ key, value, href }) => (
          <li key={key}>
            <Link href={href} className="block h-full rounded-2xl border bg-card p-4 shadow-soft transition-colors hover:bg-secondary" data-testid={`stat-${key}`}>
              <span className="block text-xs font-medium text-muted-foreground">{t(`dashboard.cards.${key}` as never)}</span>
              <span className="mt-1 block text-2xl font-bold text-primary" data-testid={`stat-${key}-value`}>
                {format.number(value)}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link href="/admin/opportunities?status=in_review">{t("dashboard.actions.review")}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/admin/opportunities?expired=1">{t("dashboard.actions.expired")}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/admin/organizations">{t("dashboard.actions.organizations")}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/admin/import">{t("nav.import")}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/admin/sources">{t("nav.sources")}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/admin/quality">{t("nav.quality")}</Link>
        </Button>
      </div>

      <section aria-labelledby="pending-heading" className="mt-10">
        <h2 id="pending-heading" className="text-xl font-semibold">
          {t("dashboard.pendingTitle")}
        </h2>
        {pending.items.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed px-5 py-8 text-center text-muted-foreground" data-testid="pending-empty">
            {t("dashboard.pendingEmpty")}
          </p>
        ) : (
          <ul className="mt-4 space-y-3" data-testid="pending-list">
            {pending.items.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4 shadow-soft">
                <div className="min-w-0">
                  <Link href={`/admin/opportunities/${o.id}/edit`} className="font-semibold text-primary hover:underline">
                    {originalTitle(o)}
                  </Link>
                  <p className="text-sm text-muted-foreground">{o.organization.name}</p>
                  <div className="mt-2">
                    <TranslationCoverage record={o} />
                  </div>
                </div>
                <Badge variant="outline">{t("status.in_review")}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AdminShell>
  );
}
