import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { AdminShell } from "@/features/admin/admin-shell";
import { TranslationCoverage } from "@/features/admin/coverage";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { isExpiredRecord, missingTranslationLanguages, originalTitle } from "@/lib/admin/queries";
import { requireAdmin } from "@/lib/auth/admin";
import { buildMetadata } from "@/lib/metadata";
import { formatDateTimeInZone } from "@/lib/format";
import { PUBLICATION_STATUSES } from "@/types/opportunity";
import type { AdminListFilters } from "@/types/admin";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "metadata" });
  return buildMetadata({ locale, path: "/admin/opportunities", title: t("adminTitle"), description: t("adminDescription"), noindex: true });
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function parseFilters(raw: Record<string, string | string[] | undefined>): AdminListFilters {
  const status = one(raw.status);
  const verification = one(raw.verification);
  const page = Number(one(raw.page));
  return {
    ...(status && (PUBLICATION_STATUSES as readonly string[]).includes(status) ? { status: status as AdminListFilters["status"] } : {}),
    ...(verification === "verified" || verification === "unverified" || verification === "expired" ? { verification } : {}),
    ...(one(raw.expired) === "1" ? { expired: true } : {}),
    ...(one(raw.imported) === "1" ? { imported: true } : {}),
    ...(/^[a-z0-9][a-z0-9-]{3,60}$/.test(one(raw.batch) ?? "") ? { batch: one(raw.batch) } : {}),
    ...(one(raw.q)?.trim() ? { q: one(raw.q)!.trim().slice(0, 100) } : {}),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export default async function Page({ params, searchParams }: PageProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { admin } = await requireAdmin(locale, "/admin/opportunities");

  const raw = await searchParams;
  const filters = parseFilters(raw);
  const result = await admin.list(filters);
  const info = await admin.importInfo(result.items.map((o) => o.id));
  const t = await getTranslations("admin");
  const tLife = await getTranslations("lifecycle");
  const format = await getFormatter();

  const query = (page: number) => ({
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.verification ? { verification: filters.verification } : {}),
    ...(filters.expired ? { expired: "1" } : {}),
    ...(filters.imported ? { imported: "1" } : {}),
    ...(filters.batch ? { batch: filters.batch } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    ...(page > 1 ? { page: String(page) } : {}),
  });
  const adminStatuses = ["draft", "in_review", "published", "rejected", "archived"] as const;
  const filtered = Boolean(filters.status || filters.verification || filters.expired || filters.q || filters.imported || filters.batch);

  return (
    <AdminShell
      title={t("list.title")}
      actions={
        <Button asChild>
          <Link href="/admin/opportunities/new">{t("list.new")}</Link>
        </Button>
      }
    >
      {one(raw.deleted) === "1" && (
        <p role="status" className="mb-5 rounded-xl border border-accent/25 bg-secondary px-3.5 py-3 text-sm text-primary" data-testid="deleted-notice">
          {t("list.deleted")}
        </p>
      )}

      <form method="get" className="grid gap-4 rounded-2xl border bg-card p-4 shadow-soft sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto_auto]" data-testid="admin-filters">
        <div>
          <Label htmlFor="q">{t("list.search")}</Label>
          <Input id="q" name="q" defaultValue={filters.q ?? ""} placeholder={t("list.searchPlaceholder")} />
        </div>
        <div>
          <Label htmlFor="status">{t("list.filters.status")}</Label>
          <Select id="status" name="status" defaultValue={filters.status ?? ""}>
            <option value="">{t("list.filters.all")}</option>
            {adminStatuses.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="verification">{t("list.filters.verification")}</Label>
          <Select id="verification" name="verification" defaultValue={filters.verification ?? ""}>
            <option value="">{t("list.filters.all")}</option>
            <option value="verified">{t("verification.verified")}</option>
            <option value="unverified">{t("verification.unverified")}</option>
            <option value="expired">{t("verification.expired")}</option>
          </Select>
        </div>
        <div className="space-y-1 sm:col-span-2 lg:col-span-1">
          <Label className="mb-0 flex min-h-9 items-center gap-2 font-normal">
            <input type="checkbox" name="expired" value="1" defaultChecked={filters.expired} className="size-4 accent-[var(--accent)]" />
            {t("list.filters.expired")}
          </Label>
          <Label className="mb-0 flex min-h-9 items-center gap-2 font-normal">
            <input type="checkbox" name="imported" value="1" defaultChecked={filters.imported} className="size-4 accent-[var(--accent)]" />
            {t("list.filters.imported")}
          </Label>
        </div>
        {filters.batch && <input type="hidden" name="batch" value={filters.batch} />}
        <div className="flex items-end gap-2">
          <Button type="submit">{t("list.filters.apply")}</Button>
          {filtered && (
            <Button asChild variant="outline">
              <Link href="/admin/opportunities">{t("list.filters.reset")}</Link>
            </Button>
          )}
        </div>
      </form>

      {filters.batch && (
        <p className="mt-4 text-sm font-medium text-primary" data-testid="batch-filter">
          {t("list.filters.batch", { batch: filters.batch })}
        </p>
      )}
      <p className="mt-4 text-sm text-muted-foreground" data-testid="result-count">
        {t("list.count", { count: result.total })}
      </p>

      {result.items.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed px-5 py-12 text-center text-muted-foreground" data-testid="list-empty">
          {filtered ? t("list.emptyFiltered") : t("list.empty")}
        </p>
      ) : (
        <ul className="mt-4 space-y-3" data-testid="admin-list">
          {result.items.map((o) => {
            const expired = isExpiredRecord(o);
            const missing = missingTranslationLanguages(o);
            return (
              <li key={o.id} className="rounded-2xl border bg-card p-4 shadow-soft sm:p-5" data-testid="admin-item" data-status={o.publicationStatus} data-slug={o.slug} data-expired={expired ? "true" : undefined} data-missing={missing.join(",")}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{t(`status.${o.publicationStatus}` as never)}</Badge>
                  <Badge variant={o.verificationStatus === "verified" ? "success" : "muted"}>{t(`verification.${o.verificationStatus === "verified" ? "verified" : "unverified"}` as never)}</Badge>
                  {expired && <Badge variant="warning">{t("list.expiredBadge")}</Badge>}
                  {o.isDemo && <Badge variant="demo">{t("list.demoBadge")}</Badge>}
                  {info[o.id]?.importBatch && <Badge variant="outline" data-testid="imported-badge">{t("list.importedBadge", { batch: info[o.id]!.importBatch! })}</Badge>}
                </div>
                <h2 className="mt-2 text-lg font-semibold leading-snug">
                  <Link href={`/admin/opportunities/${o.id}/edit`} className="text-primary hover:underline" lang={o.originalLanguage}>
                    {originalTitle(o)}
                  </Link>
                </h2>
                <p className="text-sm text-muted-foreground">
                  {o.organization.name}
                  {" · "}
                  {o.deadlineType === "fixed" && o.applicationDeadline ? formatDateTimeInZone(o.applicationDeadline, locale, o.deadlineTimezone) : o.deadlineType === "rolling" ? tLife("rolling") : t("list.deadlineUnknown")}
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <TranslationCoverage record={o} />
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{format.dateTime(new Date(o.updatedAt), { dateStyle: "medium", timeZone: "Asia/Baku" })}</span>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/admin/opportunities/${o.id}/edit`}>{t("list.edit")}</Link>
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {result.totalPages > 1 && (
        <nav className="mt-6 flex items-center justify-between gap-3" aria-label={t("list.page", { page: result.page, total: result.totalPages })}>
          {result.page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={{ pathname: "/admin/opportunities", query: query(result.page - 1) }}>{t("list.prev")}</Link>
            </Button>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted-foreground">{t("list.page", { page: result.page, total: result.totalPages })}</span>
          {result.page < result.totalPages ? (
            <Button asChild variant="outline" size="sm">
              <Link href={{ pathname: "/admin/opportunities", query: query(result.page + 1) }}>{t("list.next")}</Link>
            </Button>
          ) : (
            <span />
          )}
        </nav>
      )}
    </AdminShell>
  );
}
