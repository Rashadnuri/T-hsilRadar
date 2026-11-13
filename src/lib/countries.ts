import type { Locale } from "@/i18n/routing";

/**
 * ISO 3166-1 alpha-2 country codes and their localized names, from CLDR via Intl (no
 * hand-maintained table of 250 × 3 names). A code is "assigned" when Intl knows a name for it.
 */
let codes: string[] | undefined;

export function getIsoCountryCodes(): readonly string[] {
  if (!codes) {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    codes = [];
    for (const a of letters) for (const b of letters) {
      const code = a + b;
      const name = names.of(code);
      if (name && name !== code) codes.push(code);
    }
  }
  return codes;
}

export const isIsoCountryCode = (value: string): boolean => /^[A-Z]{2}$/.test(value) && getIsoCountryCodes().includes(value);

/** Options for a country <select>: localized, sorted by the locale's collation, Azerbaijan first. */
export function getCountryOptions(locale: Locale): { value: string; label: string }[] {
  const names = new Intl.DisplayNames([locale], { type: "region" });
  const collator = new Intl.Collator(locale);
  return getIsoCountryCodes()
    .map((value) => ({ value, label: names.of(value) ?? value }))
    .sort((a, b) => (a.value === "AZ" ? -1 : b.value === "AZ" ? 1 : collator.compare(a.label, b.label)));
}

/** Common spoken languages offered in the profile (ISO 639-1); names are shown in the UI language. */
export const PROFILE_LANGUAGE_CODES = [
  "az", "ru", "en", "tr", "de", "fr", "es", "it", "pt", "ar", "fa", "ka", "uk", "pl", "nl", "zh", "ja", "ko", "hi", "he",
] as const;

export function getLanguageOptions(locale: Locale): { value: string; label: string }[] {
  const names = new Intl.DisplayNames([locale], { type: "language" });
  const collator = new Intl.Collator(locale);
  return PROFILE_LANGUAGE_CODES.map((value) => {
    const label = names.of(value) ?? value;
    return { value: value as string, label: label.charAt(0).toLocaleUpperCase(locale) + label.slice(1) };
  }).sort((a, b) => collator.compare(a.label, b.label));
}
