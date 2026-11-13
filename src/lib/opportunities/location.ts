import type { Locale } from "@/i18n/routing";
import { regionName } from "@/lib/format";
import type { CountryCode, MarketScope, Opportunity } from "@/types/opportunity";
import { getCity, getCityName } from "./cities";

export const AZERBAIJAN: CountryCode = "AZ";

type LocationFields = Pick<Opportunity, "country" | "cityId" | "cityText" | "locationType">;

export const isInAzerbaijan = (o: Pick<Opportunity, "country">) => o.country === AZERBAIJAN;

/** City + country as display strings in the UI locale. Remote opportunities may have neither. */
export function getLocationParts(o: LocationFields, locale: Locale): { city: string | null; country: string | null } {
  return {
    city: getCityName(o.cityId, o.cityText, locale),
    country: o.country ? regionName(o.country, locale) : null,
  };
}

/**
 * Market segment, derived (never stored independently, so it cannot drift from the facts):
 *  - hosted in Azerbaijan → "azerbaijan"
 *  - hosted abroad → "international"
 *  - remote with no host country → "both", unless eligibility is limited to Azerbaijan only
 *    ("azerbaijan") or excludes Azerbaijan ("international").
 */
export function deriveMarketScope(o: Pick<Opportunity, "country" | "eligibleCountries">): MarketScope {
  if (o.country) return o.country === AZERBAIJAN ? "azerbaijan" : "international";
  if (o.eligibleCountries === null) return "both";
  if (o.eligibleCountries.every((c) => c === AZERBAIJAN)) return "azerbaijan";
  return o.eligibleCountries.includes(AZERBAIJAN) ? "both" : "international";
}

export type CountryEligibility = "eligible" | "not_eligible" | "unspecified";

/**
 * Can a citizen/resident of `country` apply? `unspecified` (the source states no restriction)
 * is deliberately different from `eligible`: the UI must not claim eligibility the source never stated.
 */
export function checkCountryEligibility(o: Pick<Opportunity, "eligibleCountries">, country: CountryCode): CountryEligibility {
  if (o.eligibleCountries === null) return "unspecified";
  return o.eligibleCountries.includes(country) ? "eligible" : "not_eligible";
}

/** Consistency problems between the location fields (used by validation). */
export function getLocationIssues(o: LocationFields): string[] {
  const issues: string[] = [];
  if ((o.locationType === "onsite" || o.locationType === "hybrid") && !o.country) issues.push("country_required_for_onsite_or_hybrid");
  if (o.cityId) {
    const city = getCity(o.cityId);
    if (!city) issues.push("unknown_city");
    else if (o.country && city.country !== o.country) issues.push("city_country_mismatch");
    else if (!o.country) issues.push("city_requires_country");
  }
  if (o.cityId && o.cityText) issues.push("city_id_and_text_both_set");
  return issues;
}
