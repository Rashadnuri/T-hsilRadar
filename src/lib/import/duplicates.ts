import { foldText } from "@/utils/fold-text";
import { normalizeUrl } from "./urls";

/** One existing opportunity, reduced to what duplicate detection needs (see the admin_duplicate_index function). */
export interface DuplicateIndexEntry {
  id: string;
  slug: string;
  organizationId: string;
  officialSourceUrl: string | null;
  applicationDeadline: string | null;
  status: string;
  titles: string[];
}

export interface DuplicateCandidate {
  slug: string;
  organizationId: string;
  officialSourceUrl: string | null;
  applicationDeadline: string | null;
  titles: string[];
}

/**
 *  - same_url:     the same official page (after normalising case, www., tracking parameters…)  → exact
 *  - same_slug:    the slug is taken                                                              → exact
 *  - similar_title: same organization and a very similar title (any language)                      → possible
 */
export type DuplicateReason = "same_url" | "same_slug" | "similar_title";

export interface DuplicateMatch {
  id: string;
  slug: string;
  reason: DuplicateReason;
  /** exact = never imported again; possible = a person decides. */
  level: "exact" | "possible";
  /** 0..1, only meaningful for similar_title. */
  similarity: number;
}

const tokens = (title: string): Set<string> => new Set(foldText(title).split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2));

/** Jaccard similarity of the word sets of two titles (accent- and case-insensitive). */
export function titleSimilarity(a: string, b: string): number {
  const [ta, tb] = [tokens(a), tokens(b)];
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

export const SIMILAR_TITLE_THRESHOLD = 0.75;

/** All existing records that look like the candidate, most certain first. */
export function findDuplicates(candidate: DuplicateCandidate, index: readonly DuplicateIndexEntry[], options: { ignoreSlug?: boolean } = {}): DuplicateMatch[] {
  const url = candidate.officialSourceUrl ? normalizeUrl(candidate.officialSourceUrl) : null;
  const matches: DuplicateMatch[] = [];
  for (const existing of index) {
    if (url && existing.officialSourceUrl && normalizeUrl(existing.officialSourceUrl) === url) {
      matches.push({ id: existing.id, slug: existing.slug, reason: "same_url", level: "exact", similarity: 1 });
      continue;
    }
    if (!options.ignoreSlug && existing.slug === candidate.slug) {
      matches.push({ id: existing.id, slug: existing.slug, reason: "same_slug", level: "exact", similarity: 1 });
      continue;
    }
    if (existing.organizationId !== candidate.organizationId) continue;
    let best = 0;
    for (const a of candidate.titles) for (const b of existing.titles) best = Math.max(best, titleSimilarity(a, b));
    if (best >= SIMILAR_TITLE_THRESHOLD) matches.push({ id: existing.id, slug: existing.slug, reason: "similar_title", level: "possible", similarity: Math.round(best * 100) / 100 });
  }
  return matches.sort((x, y) => Number(y.level === "exact") - Number(x.level === "exact") || y.similarity - x.similarity);
}
