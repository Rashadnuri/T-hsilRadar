import type { City } from "@/types/location";
import type { Locale } from "@/i18n/routing";

/**
 * Reference cities (DATA_MODEL.md §3.5). Azerbaijani cities are first-class; the international
 * list only contains cities that currently appear in records and grows through the admin UI
 * (`cities` table). Names are standard exonyms/endonyms per language, not machine output.
 * Cities not listed here are stored as free text (`Opportunity.cityText`) exactly as published.
 */
export const CITIES: readonly City[] = [
  { id: "baku", country: "AZ", names: { az: "Bakı", ru: "Баку", en: "Baku" } },
  { id: "sumgait", country: "AZ", names: { az: "Sumqayıt", ru: "Сумгаит", en: "Sumgait" } },
  { id: "ganja", country: "AZ", names: { az: "Gəncə", ru: "Гянджа", en: "Ganja" } },
  { id: "mingachevir", country: "AZ", names: { az: "Mingəçevir", ru: "Мингечевир", en: "Mingachevir" } },
  { id: "shirvan", country: "AZ", names: { az: "Şirvan", ru: "Ширван", en: "Shirvan" } },
  { id: "lankaran", country: "AZ", names: { az: "Lənkəran", ru: "Ленкорань", en: "Lankaran" } },
  { id: "shaki", country: "AZ", names: { az: "Şəki", ru: "Шеки", en: "Shaki" } },
  { id: "nakhchivan", country: "AZ", names: { az: "Naxçıvan", ru: "Нахичевань", en: "Nakhchivan" } },
  { id: "berlin", country: "DE", names: { az: "Berlin", ru: "Берлин", en: "Berlin" } },
  { id: "zurich", country: "CH", names: { az: "Sürix", ru: "Цюрих", en: "Zurich" } },
  { id: "cambridge-gb", country: "GB", names: { az: "Kembric", ru: "Кембридж", en: "Cambridge" } },
  { id: "istanbul", country: "TR", names: { az: "İstanbul", ru: "Стамбул", en: "Istanbul" } },
  { id: "amsterdam", country: "NL", names: { az: "Amsterdam", ru: "Амстердам", en: "Amsterdam" } },
  { id: "boston", country: "US", names: { az: "Boston", ru: "Бостон", en: "Boston" } },
];

const byId = new Map(CITIES.map((c) => [c.id, c]));

export const getCity = (id: string | null | undefined): City | undefined => (id ? byId.get(id) : undefined);

export const getAzerbaijaniCities = () => CITIES.filter((c) => c.country === "AZ");

/** Localized city name, or the free text exactly as published when the city is not in the reference list. */
export function getCityName(cityId: string | null, cityText: string | null, locale: Locale): string | null {
  return getCity(cityId)?.names[locale] ?? cityText ?? null;
}
