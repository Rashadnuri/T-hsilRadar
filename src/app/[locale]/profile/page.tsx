import { CheckCircle2, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Container } from "@/components/layout/container";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { AppRole } from "@/types/admin";
import { LogoutButton } from "@/features/auth/logout-button";
import { ProfileForm } from "@/features/profile/profile-form";
import { routing } from "@/i18n/routing";
import { getAuthContext, requireUser } from "@/lib/auth/session";
import { getCountryOptions, getLanguageOptions } from "@/lib/countries";
import { buildMetadata } from "@/lib/metadata";
import { EMPTY_PROFILE_INPUT, type ProfileInput } from "@/types/profile";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string | string[] }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "metadata" });
  // A private page: never indexed.
  return buildMetadata({ locale, path: "/profile", title: t("profileTitle"), description: t("profileDescription"), noindex: true });
}

export default async function Page({ params, searchParams }: PageProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  // Authoritative check (the proxy only does an optimistic one). Unauthenticated → login, same language.
  const user = await requireUser(locale, "/profile");
  const { profiles, roles } = await getAuthContext();
  const isAdmin = roles ? (await roles.getRoles(user.id).catch((): AppRole[] => [])).includes("admin") : false;
  // Always the verified session user's own row (and row level security enforces it again).
  const existing = profiles ? await profiles.get(user.id) : null;
  const initial: ProfileInput = existing ?? { ...EMPTY_PROFILE_INPUT, fullName: user.fullName };

  const { status } = await searchParams;
  const passwordUpdated = (Array.isArray(status) ? status[0] : status) === "password_updated";
  const t = await getTranslations("profile");
  const tNav = await getTranslations("nav");

  return (
    <Container className="py-10 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("subtitle")}</p>
        <p className="mt-4 flex items-start gap-2.5 rounded-xl border bg-secondary px-3.5 py-3 text-sm text-primary">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          {t("privacy")}
        </p>
        {passwordUpdated && (
          <p role="status" className="mt-4 flex items-start gap-2.5 rounded-xl border border-accent/25 bg-secondary px-3.5 py-3 text-sm text-primary">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
            {t("passwordUpdated")}
          </p>
        )}

        <section aria-labelledby="account-heading" className="mt-6 flex flex-col gap-3 rounded-2xl border bg-card p-5 shadow-soft sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="min-w-0">
            <h2 id="account-heading" className="text-sm font-medium text-muted-foreground">
              {t("account.email")}
            </h2>
            <p className="break-all font-medium" data-testid="account-email">
              {user.email}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {isAdmin && (
              <Button asChild variant="accent" className="w-full sm:w-auto" data-testid="admin-link">
                <Link href="/admin">{tNav("admin")}</Link>
              </Button>
            )}
            <LogoutButton variant="outline" className="w-full sm:w-auto">
              {t("account.logout")}
            </LogoutButton>
          </div>
        </section>

        <div className="mt-6">
          <ProfileForm initial={initial} countries={getCountryOptions(locale)} languages={getLanguageOptions(locale)} />
        </div>
      </div>
    </Container>
  );
}
