import type { CountryCode } from "./opportunity";

/** Names per platform locale; other languages are not stored (cities are reference data). */
export interface CityNames {
  az: string;
  ru: string;
  en: string;
}

/** Reference city (DATA_MODEL.md §3.5). `id` is a stable slug. */
export interface City {
  id: string;
  country: CountryCode;
  names: CityNames;
}
