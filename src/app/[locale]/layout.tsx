import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteFooter } from "@/components/layout/site-footer";
import { Navbar } from "@/components/layout/navbar";
import { routing } from "@/i18n/routing";
import { buildMetadata } from "@/lib/metadata";
import { getSiteUrl } from "@/lib/site";
import "../globals.css";

// Latin Extended covers Azerbaijani letters (ə ğ ı ö ü ç ş, and the "ə" of the brand name on EVERY page);
// Cyrillic covers Russian. One instance only: a second `Inter` instance (to avoid preloading Cyrillic, ~19 KB)
// was tried and measured WORSE, because Next declares every instance under the family name "Inter" and the
// browser then downloads the Latin files twice.
const inter = Inter({
  subsets: ["latin", "latin-ext", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
});

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f2557",
};

export async function generateMetadata({ params }: Pick<LayoutProps, "params">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "metadata" });
  return {
    metadataBase: new URL(getSiteUrl()),
    ...buildMetadata({ locale, title: t("defaultTitle"), description: t("defaultDescription") }),
    // AFTER the spread: buildMetadata's plain `title` string would otherwise replace this object and
    // the template ("%s | TəhsilRadar") would never reach the child pages.
    title: { default: t("defaultTitle"), template: t("titleTemplate") },
  };
}

export default async function LocaleLayout({ children, params }: LayoutProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale); // enables static rendering for this locale

  const t = await getTranslations({ locale, namespace: "common" });

  return (
    <html lang={locale} className={inter.variable}>
      <body className="flex min-h-dvh flex-col">
        <NextIntlClientProvider>
          <a
            href="#main-content"
            className="sr-only z-50 rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
          >
            {t("skipToContent")}
          </a>
          <Navbar />
          <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
            {children}
          </main>
          <SiteFooter />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
