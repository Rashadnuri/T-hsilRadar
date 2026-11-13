"use client";

import { useTranslations } from "next-intl";

/**
 * Screen-reader announcement for loading states. Deliberately a client component:
 * it reads from the NextIntlClientProvider context, so `loading.tsx` does not need
 * request headers (which would force every page to render dynamically).
 */
export function LoadingStatus() {
  const t = useTranslations("common");
  return (
    <p role="status" className="sr-only">
      {t("loading")}
    </p>
  );
}
