import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { LoginForm } from "@/features/auth/auth-forms";
import { AuthShell } from "@/features/auth/auth-shell";
import { Link } from "@/i18n/navigation";
import { getAuthMode } from "@/lib/auth/mode";
import { safeNextPath } from "@/lib/auth/redirects";
import { redirectIfAuthenticated } from "@/lib/auth/session";
import { routing } from "@/i18n/routing";
import { buildMetadata } from "@/lib/metadata";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string | string[]; error?: string | string[] }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "metadata" });
  // Account pages are not useful search results.
  return buildMetadata({ locale, path: "/login", title: t("loginTitle"), description: t("loginDescription"), noindex: true });
}

export default async function Page({ params, searchParams }: PageProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { next: rawNext, error } = await searchParams;
  const next = safeNextPath(Array.isArray(rawNext) ? rawNext[0] : rawNext);
  // Already signed in: go straight to the destination, in the same language.
  await redirectIfAuthenticated(locale, next);
  const t = await getTranslations("auth");
  const tErr = await getTranslations("authErrors");
  const mode = getAuthMode();

  return (
    <AuthShell
      title={t("login.title")}
      subtitle={t("login.subtitle")}
      notice={mode === "unconfigured" ? tErr("not_configured") : error === "invalid_link" ? tErr("invalid_link") : undefined}
      footer={
        <>
          {t("login.switchText")}{" "}
          <Link href="/register" className="font-semibold text-accent hover:underline">
            {t("login.switchLink")}
          </Link>
        </>
      }
    >
      <LoginForm next={next} />
    </AuthShell>
  );
}
