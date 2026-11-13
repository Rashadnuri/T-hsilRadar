import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AdminShell } from "@/features/admin/admin-shell";
import { OpportunityForm } from "@/features/admin/opportunity-form";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { buildFormOptions } from "@/lib/admin/form-options";
import { EMPTY_FORM_VALUES } from "@/lib/admin/form-values";
import { requireAdmin } from "@/lib/auth/admin";
import { buildMetadata } from "@/lib/metadata";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "metadata" });
  return buildMetadata({ locale, path: "/admin/opportunities/new", title: t("adminTitle"), description: t("adminDescription"), noindex: true });
}

export default async function Page({ params }: PageProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { admin } = await requireAdmin(locale, "/admin/opportunities/new");
  const t = await getTranslations("admin.form");
  const options = buildFormOptions(locale, await admin.listOrganizations());

  return (
    <AdminShell title={t("createTitle")}>
      <p className="-mt-4 mb-6">
        <Link href="/admin/opportunities" className="text-sm font-semibold text-accent hover:underline">
          {t("back")}
        </Link>
      </p>
      <OpportunityForm mode="create" values={EMPTY_FORM_VALUES} states={{}} {...options} />
    </AdminShell>
  );
}
