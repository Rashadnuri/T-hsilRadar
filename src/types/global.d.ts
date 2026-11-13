import type { Locale } from "@/i18n/routing";
import type az from "@/messages/az.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    // Message keys are type-checked against the Azerbaijani (source) dictionary.
    Messages: typeof az;
  }
}
