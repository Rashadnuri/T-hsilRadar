import { createTranslator } from "next-intl";
import az from "@/messages/az.json";
import { defaultLocale } from "@/i18n/routing";
import "./globals.css";

/**
 * Last-resort 404 for URLs that match no locale route (e.g. paths with a file extension).
 * Rendered outside the locale layout, so it provides its own <html>, in the default
 * language, using the dictionary directly (no request context needed).
 */
export default function RootNotFound() {
  const t = createTranslator({ locale: defaultLocale, messages: az });
  return (
    <html lang={defaultLocale}>
      <body className="grid min-h-dvh place-items-center px-4 text-center">
        <div>
          <h1 className="text-3xl font-bold">{t("notFound.title")}</h1>
          <p className="mt-3 text-muted-foreground">{t("notFound.text")}</p>
          <a href={`/${defaultLocale}`} className="mt-6 inline-block font-semibold text-accent underline">
            {t("common.backToHome")}
          </a>
        </div>
      </body>
    </html>
  );
}
