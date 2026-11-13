/**
 * Normalises text for search (INTERNATIONALIZATION.md §5): lowercase with Azerbaijani
 * casing rules, diacritics stripped, and ə/ı folded, so "Təqaüd", "teqaud" and "TƏQAÜD"
 * all match. Exact-diacritic matches can be ranked higher by comparing unfolded text.
 */
export function foldText(input: string): string {
  return input
    .toLocaleLowerCase("az")
    .replace(/ə/g, "e")
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ё/g, "е");
}
