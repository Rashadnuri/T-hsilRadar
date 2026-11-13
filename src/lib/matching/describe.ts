import type { Criterion } from "./types";

/** Every message variant the UI has text for (messages `matching.criteria.<id>.<variant>`). */
export const CRITERION_VARIANTS = new Set([
  "open.met", "open.met_upcoming", "open.met_rolling", "open.met_deadline_unknown", "open.unmet",
  "education.met", "education.met_graduate_rule", "education.unmet", "education.unmet_graduate_rule", "education.unknown", "education.unknown_needs_graduation_year",
  "field.met", "field.unmet", "field.unknown",
  "country.met", "country.unmet", "country.unknown",
  "type.met", "type.unmet", "type.unknown",
  "location.met", "location.partial_remote", "location.unmet", "location.unknown",
  "interests.met", "interests.partial", "interests.unmet", "interests.unknown", "interests.unknown_no_text",
  "language.met", "language.partial_low_level", "language.unmet", "language.unknown",
]);

/** The message key (below `matching.criteria.`) that explains a criterion's result. */
export function criterionMessageKey(c: Pick<Criterion, "id" | "status" | "detail">): string {
  const withNote = c.detail.note ? `${c.id}.${c.status}_${c.detail.note}` : null;
  if (withNote && CRITERION_VARIANTS.has(withNote)) return withNote;
  return `${c.id}.${c.status}`;
}

/** Display helpers supplied by the UI (they know the visitor's language). */
export interface DescribeTools {
  level(code: string): string;
  field(code: string): string;
  type(code: string): string;
  country(code: string): string;
  language(code: string): string;
  list(items: string[]): string;
}

/** Turns the codes in a criterion into the localized values its message template expects. */
export function criterionValues(c: Criterion, tools: DescribeTools): Record<string, string | number> {
  const label = (code: string): string => {
    switch (c.id) {
      case "education": return tools.level(code);
      case "field": return tools.field(code);
      case "type": return tools.type(code);
      case "country":
      case "location": return tools.country(code);
      case "language": return tools.language(code);
      default: return code;
    }
  };
  const many = (items: string[] | undefined) => tools.list((items ?? []).map(label));
  const yours = c.detail.yours;
  return {
    accepted: many(c.detail.accepted),
    yours: Array.isArray(yours) ? many(yours) : typeof yours === "string" ? label(yours) : typeof yours === "number" ? yours : "",
    // matched items are free text (skills) for "interests", language codes for "language"
    matched: c.id === "language" ? many(c.detail.matched) : tools.list(c.detail.matched ?? []),
    year: c.detail.year ?? "",
  };
}
