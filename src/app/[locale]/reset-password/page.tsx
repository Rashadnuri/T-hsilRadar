import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ResetPasswordForm } from "@/features/auth/auth-forms";
import { AuthShell } from "@/features/auth/auth-shell";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getCurrentUser } from "@/lib/auth/session";
import { buildMetadata } from "@/lib/metadata";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "metadata" });
  return buildMetadata({ locale, path: "/reset-password", title: t("resetPasswordTitle"), description: t("resetPasswordDescription"), noindex: true });
}

export default async function Page({ params }: PageProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  // Only reachable with the short-lived recovery session created by the emailed link.
  if (!(await getCurrentUser())) {
    redirect({ href: { pathname: "/forgot-password" }, locale });
  }
  const t = await getTranslations("auth");

  return (
    <AuthShell
      title={t("resetPassword.title")}
      subtitle={t("resetPassword.subtitle")}
    >
      <ResetPasswordForm />
    </AuthShell>
  );
}
