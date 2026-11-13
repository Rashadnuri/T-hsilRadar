"use client";

import { createTranslator } from "next-intl";
import az from "@/messages/az.json";
import "./globals.css";

/**
 * Catches errors in the root/locale layouts, where the normal i18n provider is not available.
 * Uses the default-language dictionary directly (no hard-coded text).
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = createTranslator({ locale: "az", messages: az });
  return (
    <html lang="az">
      <body className="grid min-h-dvh place-items-center px-4 text-center">
        <div role="alert">
          <h1 className="text-3xl font-bold">{t("error.title")}</h1>
          <p className="mt-3 text-muted-foreground">{t("error.text")}</p>
          <button
            type="button"
            onClick={reset}
            className="mt-6 h-11 rounded-lg bg-primary px-5 font-semibold text-primary-foreground"
          >
            {t("common.tryAgain")}
          </button>
        </div>
      </body>
    </html>
  );
}
