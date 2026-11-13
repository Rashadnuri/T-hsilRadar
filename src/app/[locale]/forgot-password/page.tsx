import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ForgotPasswordForm } from "@/features/auth/auth-forms";
import { AuthShell } from "@/features/auth/auth-shell";
import { Link } from "@/i18n/navigation";
import { getAuthMode } from "@/lib/auth/mode";
import { redirectIfAuthenticated } from "@/lib/auth/session";
import { routing } from "@/i18n/routing";
import { buildMetadata } from "@/lib/metadata";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "metadata" });
  // Account pages are not useful search results.
  return buildMetadata({ locale, path: "/forgot-password", title: t("forgotPasswordTitle"), description: t("forgotPasswordDescription"), noindex: true });
}

export default async function Page({ params }: PageProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await redirectIfAuthenticated(locale);
  const t = await getTranslations("auth");
  const tErr = await getTranslations("authErrors");

  return (
    <AuthShell
      title={t("forgotPassword.title")}
      notice={getAuthMode() === "unconfigured" ? tErr("not_configured") : undefined}
      subtitle={t("forgotPassword.subtitle")}
      footer={
        <>
          {t("forgotPassword.switchText")}{" "}
          <Link href="/login" className="font-semibold text-accent hover:underline">
            {t("forgotPassword.switchLink")}
          </Link>
        </>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
