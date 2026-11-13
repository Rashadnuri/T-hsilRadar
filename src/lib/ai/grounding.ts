import type { Locale } from "@/i18n/routing";

/**
 * Output checks. The model is told never to invent facts, but that is a request, not a
 * guarantee, so the answer is also CHECKED against the data it was given:
 *  - every number of two or more digits in the answer (years, days, amounts, percentages, dates)
 *    must also occur in the data the model received; the rest are reported as "unverified";
 *  - the answer must be written in the requested language (script check).
 * A check can't prove an answer true, only catch the most harmful kind of invention; the UI also
 * labels every answer as AI-generated and points to the official source.
 */

const digitRuns = (text: string): string[] => text.match(/\d{2,}/g) ?? [];

/** Numbers in `answer` that appear nowhere in `sourceText` (the exact text the model was given). */
export function findUngroundedNumbers(answer: string, sourceText: string): string[] {
  const allowed = new Set(digitRuns(sourceText));
  const unknown = new Set<string>();
  for (const run of digitRuns(answer)) if (!allowed.has(run)) unknown.add(run);
  return [...unknown];
}

const letters = (text: string) => text.match(/\p{L}/gu) ?? [];

/** Rough script check: Russian answers must be mostly Cyrillic, Azerbaijani/English answers mostly Latin. */
export function matchesLanguage(text: string, locale: Locale): boolean {
  const all = letters(text);
  if (all.length < 20) return true; // too short to judge
  const cyrillic = all.filter((c) => /\p{Script=Cyrillic}/u.test(c)).length / all.length;
  return locale === "ru" ? cyrillic >= 0.6 : cyrillic <= 0.2;
}

export type AiWarning = "unverified_numbers" | "language_mismatch" | "links_removed" | "truncated";
