import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdminShell } from "@/features/admin/admin-shell";
import { SourceActions } from "@/features/admin/source-actions";
import { SourceForm } from "@/features/admin/source-form";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { requireAdmin } from "@/lib/auth/admin";
import { getCountryOptions } from "@/lib/countries";
import { buildMetadata } from "@/lib/metadata";
import { isSourceOverdue } from "@/types/source";
import { parseOpportunityId } from "@/validation/plan";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ edit?: string | string[] }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "metadata" });
  return buildMetadata({ locale, path: "/admin/sources", title: t("adminTitle"), description: t("adminDescription"), noindex: true });
}

export default async function Page({ params, searchParams }: PageProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { admin } = await requireAdmin(locale, "/admin/sources");

  const editParam = (await searchParams).edit;
  const editId = parseOpportunityId(Array.isArray(editParam) ? editParam[0] : editParam);
  const [sources, organizations, t, tKind, format] = await Promise.all([admin.listSources(), admin.listOrganizations(), getTranslations("admin.sources"), getTranslations("orgKinds"), getFormatter()]);
  const editing = editId ? sources.find((s) => s.id === editId) : undefined;
  const regions = new Intl.DisplayNames([locale], { type: "region" });
  const now = new Date();

  return (
    <AdminShell title={t("title")} subtitle={t("subtitle")}>
      <p className="-mt-3 mb-6 max-w-3xl rounded-xl border bg-secondary px-4 py-3 text-sm text-primary" data-testid="source-rules">
        {t("rules")}
      </p>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start">
        <section aria-labelledby="source-list-heading" className="min-w-0">
          <h2 id="source-list-heading" className="sr-only">
            {t("title")}
          </h2>
          {sources.length === 0 ? (
            <p className="rounded-2xl border border-dashed px-5 py-10 text-center text-muted-foreground" data-testid="sources-empty">
              {t("empty")}
            </p>
          ) : (
            <ul className="space-y-3" data-testid="source-list">
              {sources.map((s) => {
                const overdue = isSourceOverdue(s, now);
                return (
                  <li key={s.id} className="space-y-3 rounded-2xl border bg-card p-4 shadow-soft" data-testid="source-item" data-name={s.organizationName} data-active={s.isActive ? "true" : "false"} data-overdue={overdue ? "true" : "false"}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{tKind(s.sourceType)}</Badge>
                      <Badge variant={s.isActive ? "success" : "muted"}>{s.isActive ? t("active") : t("inactive")}</Badge>
                      {overdue && <Badge variant="warning">{t("overdue")}</Badge>}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-primary">{s.organizationName}</p>
                      <a href={s.websiteUrl} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-sm text-accent hover:underline">
                        {s.websiteUrl}
                      </a>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {[s.country ? (regions.of(s.country) ?? s.country) : null, t(`accessMethods.${s.accessMethod}` as never)].filter(Boolean).join(" · ")}
                      </p>
                      <p className="text-sm text-muted-foreground" data-testid="last-checked">
                        {s.lastCheckedAt ? t("lastChecked", { date: format.dateTime(new Date(s.lastCheckedAt), { dateStyle: "medium", timeZone: "Asia/Baku" }) }) : t("never")}
                      </p>
                      {s.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/80">{s.notes}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link href={{ pathname: "/admin/sources", query: { edit: s.id } }}>{t("edit")}</Link>
                      </Button>
                      <SourceActions id={s.id} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <SourceForm
          key={editing?.id ?? "new"}
          countries={getCountryOptions(locale)}
          organizations={organizations.map((o) => ({ value: o.id, label: o.name }))}
          initial={{
            id: editing?.id, organizationName: editing?.organizationName ?? "", websiteUrl: editing?.websiteUrl ?? "", sourceType: editing?.sourceType ?? "", country: editing?.country ?? "",
            accessMethod: editing?.accessMethod ?? "official_website", notes: editing?.notes ?? "", isActive: editing?.isActive ?? true, organizationId: editing?.organizationId ?? "",
          }}
        />
      </div>
    </AdminShell>
  );
}
