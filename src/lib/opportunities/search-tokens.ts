import az from "@/messages/az.json";
import en from "@/messages/en.json";
import ru from "@/messages/ru.json";
import { locales } from "@/i18n/routing";
import { foldText } from "@/utils/fold-text";
import { getIsoCountryCodes } from "@/lib/countries";
import { CITIES } from "./cities";
import { EDUCATION_LEVELS, FIELDS_OF_STUDY, FUNDING_TYPES, LOCATION_TYPES, OPPORTUNITY_TYPES } from "@/types/opportunity";

/**
 * How multilingual "keyword" search reaches the database.
 *
 * The labels people search by ("scholarship", "стипендии", "təqaüdlər", "Баку", "Germany") live
 * in the UI dictionaries and in CLDR, not in the database. So the app resolves each search word
 * into the CODES whose label — in ANY of the three languages — contains it, and the SQL function
 * matches those codes. The database never needs a copy of the dictionaries, and adding a language
 * only touches the dictionaries.
 *
 * Mirrors the "keywords" index in lib/opportunities/search.ts (same labels, same substring rule).
 */

const MESSAGES = { az, ru, en } as const;

export interface SearchToken {
  /** The folded word, matched as a substring of title / organization / description text. */
  txt: string;
  types: string[];
  locations: string[];
  fundings: string[];
  levels: string[];
  fields: string[];
  cities: string[];
  countries: string[];
}

const countryNameCache = new Map<string, string>();
function foldedCountryNames(code: string): string {
  let cached = countryNameCache.get(code);
  if (cached === undefined) {
    cached = foldText(locales.map((l) => new Intl.DisplayNames([l], { type: "region" }).of(code) ?? "").join(" "));
    countryNameCache.set(code, cached);
  }
  return cached;
}

const labels = <T extends string>(codes: readonly T[], pick: (messages: (typeof MESSAGES)[keyof typeof MESSAGES], code: T) => string) =>
  new Map(codes.map((code) => [code, foldText(locales.map((l) => pick(MESSAGES[l], code)).join(" "))] as const));

const TYPE_LABELS = labels(OPPORTUNITY_TYPES, (m, c) => m.opportunityTypes[c]);
const LOCATION_LABELS = labels(LOCATION_TYPES, (m, c) => m.locationType[c]);
const FUNDING_LABELS = labels(FUNDING_TYPES, (m, c) => m.funding[c]);
const LEVEL_LABELS = labels(EDUCATION_LEVELS, (m, c) => m.level[c]);
const FIELD_LABELS = labels(FIELDS_OF_STUDY, (m, c) => m.fields[c]);
const CITY_LABELS = new Map(CITIES.map((c) => [c.id, foldText(locales.map((l) => c.names[l]).join(" "))] as const));

const matching = (map: Map<string, string>, word: string) => [...map].filter(([, text]) => text.includes(word)).map(([code]) => code);

export function resolveSearchTokens(query: string | undefined): SearchToken[] {
  if (!query) return [];
  return foldText(query)
    .split(/\s+/)
    .filter(Boolean)
    .map((txt) => ({
      txt,
      types: matching(TYPE_LABELS, txt),
      locations: matching(LOCATION_LABELS, txt),
      fundings: matching(FUNDING_LABELS, txt),
      levels: matching(LEVEL_LABELS, txt),
      fields: matching(FIELD_LABELS, txt),
      cities: matching(CITY_LABELS, txt),
      countries: getIsoCountryCodes().filter((code) => foldedCountryNames(code).includes(txt)),
    }));
}
