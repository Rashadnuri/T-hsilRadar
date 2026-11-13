import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AdminShell } from "@/features/admin/admin-shell";
import { DeleteOrganizationButton } from "@/features/admin/delete-organization-button";
import { OrganizationForm } from "@/features/admin/organization-form";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { requireAdmin } from "@/lib/auth/admin";
import { getCountryOptions } from "@/lib/countries";
import { buildMetadata } from "@/lib/metadata";
import { parseOpportunityId } from "@/validation/plan";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ edit?: string | string[] }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "metadata" });
  return buildMetadata({ locale, path: "/admin/organizations", title: t("adminTitle"), description: t("adminDescription"), noindex: true });
}

export default async function Page({ params, searchParams }: PageProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { admin } = await requireAdmin(locale, "/admin/organizations");

  const editParam = (await searchParams).edit;
  const editId = parseOpportunityId(Array.isArray(editParam) ? editParam[0] : editParam);
  const [organizations, t, tKind] = await Promise.all([admin.listOrganizations(), getTranslations("admin.orgs"), getTranslations("orgKinds")]);
  const editing = editId ? organizations.find((o) => o.id === editId) : undefined;
  const countries = getCountryOptions(locale);
  const regionNames = new Intl.DisplayNames([locale], { type: "region" });

  return (
    <AdminShell title={t("title")} subtitle={t("subtitle")}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <section aria-labelledby="org-list-heading" className="min-w-0">
          <h2 id="org-list-heading" className="sr-only">
            {t("title")}
          </h2>
          {organizations.length === 0 ? (
            <p className="rounded-2xl border border-dashed px-5 py-10 text-center text-muted-foreground" data-testid="orgs-empty">
              {t("empty")}
            </p>
          ) : (
            <ul className="space-y-3" data-testid="org-list">
              {organizations.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4 shadow-soft" data-testid="org-item" data-name={o.name}>
                  <div className="min-w-0">
                    <p className="font-semibold text-primary">{o.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {tKind(o.kind)}
                      {o.country ? ` · ${regionNames.of(o.country) ?? o.country}` : ""}
                      {" · "}
                      {t("opportunities", { count: o.opportunityCount })}
                    </p>
                    {o.websiteUrl && (
                      <a href={o.websiteUrl} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-xs text-accent hover:underline">
                        {o.websiteUrl}
                      </a>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={{ pathname: "/admin/organizations", query: { edit: o.id } }}>{t("edit")}</Link>
                    </Button>
                    <DeleteOrganizationButton id={o.id} disabled={o.opportunityCount > 0} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <OrganizationForm
          key={editing?.id ?? "new"}
          countries={countries}
          initial={{ id: editing?.id, name: editing?.name ?? "", slug: editing?.slug ?? "", kind: editing?.kind ?? "", country: editing?.country ?? "", websiteUrl: editing?.websiteUrl ?? "" }}
        />
      </div>
    </AdminShell>
  );
}
