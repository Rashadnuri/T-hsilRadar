type Dict = { [key: string]: unknown };

const isDict = (value: unknown): value is Dict =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Returns `base` overlaid with `override`. Used to fall back to the default-language
 * dictionary for any key a translation file is missing, so a raw key is never rendered.
 * Empty strings in `override` are treated as missing.
 */
export function deepMerge<T extends Dict>(base: T, override: Dict): T {
  const result: Dict = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    if (isDict(current) && isDict(value)) result[key] = deepMerge(current, value);
    else if (value !== undefined && value !== "") result[key] = value;
  }
  return result as T;
}
