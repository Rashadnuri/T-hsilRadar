/**
 * Slugs are ASCII, language-neutral and stable, so /az/…, /ru/… and /en/… share one path.
 * Azerbaijani letters and Cyrillic are transliterated rather than dropped.
 */
const MAP: Record<string, string> = {
  ə: "e", ı: "i", ö: "o", ü: "u", ç: "c", ş: "s", ğ: "g", İ: "i",
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k",
  л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

export const SLUG_MAX_LENGTH = 80;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const isValidSlug = (slug: string) => slug.length > 0 && slug.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(slug);

export function slugify(text: string): string {
  const transliterated = [...text.toLocaleLowerCase("az")].map((ch) => MAP[ch] ?? ch).join("");
  return transliterated
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
}

/** `base`, `base-2`, `base-3`… the first that is not in `taken`. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  const root = slugify(base) || "opportunity";
  if (!taken.has(root)) return root;
  for (let i = 2; ; i++) {
    const suffix = `-${i}`;
    const candidate = `${root.slice(0, SLUG_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
