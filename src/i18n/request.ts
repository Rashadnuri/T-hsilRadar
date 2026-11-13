import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import az from "@/messages/az.json";
import { deepMerge } from "@/utils/deep-merge";
import { DEFAULT_TIME_ZONE, formats } from "./formats";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  // Fallback behaviour: Azerbaijani is the base dictionary; ru/en overlay it.
  // A missing/empty key therefore shows Azerbaijani text rather than a raw key.
  // `npm run i18n:check` fails CI long before that can happen.
  const messages =
    locale === routing.defaultLocale
      ? az
      : deepMerge(az, (await import(`../messages/${locale}.json`)).default);

  return {
    locale,
    messages,
    formats,
    timeZone: DEFAULT_TIME_ZONE,
    // Always log (server-side only): a failed format or missing message must never be silent.
    onError(error) {
      console.error(error);
    },
    getMessageFallback({ namespace, key }) {
      // Never render a placeholder key to end users in production.
      return process.env.NODE_ENV === "production" ? "" : [namespace, key].filter(Boolean).join(".");
    },
  };
});
