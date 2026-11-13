import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AdminShell } from "@/features/admin/admin-shell";
import { TranslationCoverage } from "@/features/admin/coverage";
import { OpportunityForm } from "@/features/admin/opportunity-form";
import { StatusPanel } from "@/features/admin/status-panel";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { buildFormOptions } from "@/lib/admin/form-options";
import { recordToFormValues, type TranslationSlotState } from "@/lib/admin/form-values";
import { missingTranslationLanguages, originalTitle } from "@/lib/admin/queries";
import { requireAdmin } from "@/lib/auth/admin";
import { buildMetadata } from "@/lib/metadata";
import { getPublicationBlockers } from "@/lib/opportunities/status";
import { parseOpportunityId } from "@/validation/plan";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ saved?: string | string[] }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "metadata" });
  return buildMetadata({ locale, path: "/admin/opportunities", title: t("adminTitle"), description: t("adminDescription"), noindex: true });
}

export default async function Page({ params, searchParams }: PageProps) {
  const { locale, id: rawId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const id = parseOpportunityId(rawId);
  const { admin } = await requireAdmin(locale, `/admin/opportunities/${rawId}/edit`);
  if (!id) notFound();

  const record = await admin.get(id);
  if (!record) notFound();
  const [organizations, t, tCov, format] = await Promise.all([
    admin.listOrganizations(),
    getTranslations("admin.form"),
    getTranslations("admin.coverage"),
    getFormatter(),
  ]);
  const options = buildFormOptions(locale, organizations);
  const states = Object.fromEntries(record.translations.map((tr) => [tr.language, tr.status])) as Record<string, TranslationSlotState>;
  const missing = missingTranslationLanguages(record);
  // The verifier id is a hidden column: requirements are computed from what the admin API exposes; the database enforces the rest.
  const blockers = getPublicationBlockers(record, new Date(), { verifierReadable: false });
  const saved = (Array.isArray((await searchParams).saved) ? (await searchParams).saved?.[0] : (await searchParams).saved) === "1";

  return (
    <AdminShell title={t("editTitle")} subtitle={originalTitle(record)}>
      <div className="-mt-4 mb-6 flex flex-wrap items-center gap-x-6 gap-y-2">
        <Link href="/admin/opportunities" className="text-sm font-semibold text-accent hover:underline">
          {t("back")}
        </Link>
        {record.publicationStatus === "published" && (
          <Link href={`/opportunities/${record.slug}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
            {`/opportunities/${record.slug}`}
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>

      <div className="mb-6 rounded-2xl border bg-card p-4 shadow-soft" data-testid="coverage-summary">
        <TranslationCoverage record={record} />
        <p className="mt-2 text-sm text-muted-foreground">{missing.length === 0 ? tCov("complete") : tCov("summaryMissing", { languages: missing.map((l) => l.toUpperCase()).join(", ") })}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <OpportunityForm mode="edit" id={record.id} values={recordToFormValues(record)} states={states} notice={saved ? "created" : null} {...options} />
        <aside className="space-y-6 lg:sticky lg:top-24">
          <StatusPanel
            id={record.id}
            status={record.publicationStatus}
            verified={record.verificationStatus === "verified"}
            verifiedOn={record.lastVerifiedAt ? format.dateTime(new Date(record.lastVerifiedAt), { dateStyle: "medium", timeZone: "Asia/Baku" }) : null}
            officialSourceUrl={record.officialSourceUrl}
            isDemo={record.isDemo}
            blockers={blockers}
          />
        </aside>
      </div>
    </AdminShell>
  );
}
