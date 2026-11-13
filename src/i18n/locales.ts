import type { Locale } from "./routing";

/**
 * Language names are shown in their own language on purpose (so a user who
 * cannot read the current UI language can still find theirs). They are
 * identifiers, not translatable interface copy.
 */
export const localeMeta: Record<Locale, { code: string; nativeName: string; ogLocale: string }> = {
  az: { code: "AZ", nativeName: "Azərbaycanca", ogLocale: "az_AZ" },
  ru: { code: "RU", nativeName: "Русский", ogLocale: "ru_RU" },
  en: { code: "EN", nativeName: "English", ogLocale: "en_US" },
};
