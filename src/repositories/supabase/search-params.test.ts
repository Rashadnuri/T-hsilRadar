import { describe, expect, it } from "vitest";
import { parseOpportunityFilters } from "@/validation/opportunity-filters";
import { buildSearchFilters } from "./search-params";

const f = (raw: Record<string, string> = {}) => parseOpportunityFilters(raw);

describe("buildSearchFilters", () => {
  it("sends only the filters that are set, plus the effective sort", () => {
    expect(buildSearchFilters(f())).toEqual({ sort: "deadline" });
    expect(buildSearchFilters(f({ type: "internship", scope: "azerbaijan", city: "ganja", country: "az", sort: "newest" }))).toEqual({
      type: "internship", scope: "azerbaijan", city: "ganja", country: "AZ", sort: "newest",
    });
  });
  it("defaults to relevance when searching and attaches resolved tokens", () => {
    const out = buildSearchFilters(f({ q: "Баку internship" }));
    expect(out.sort).toBe("relevance");
    expect((out.tokens as { txt: string }[]).map((t) => t.txt)).toEqual(["баку", "internship"]);
  });
  it("never forwards page (paging is a separate RPC argument) or invalid values", () => {
    const out = buildSearchFilters(f({ page: "3", type: "course", funding: "free" }));
    expect(out).toEqual({ sort: "deadline" });
  });
  it("adds the app-side constraints only when requested", () => {
    expect(buildSearchFilters(f(), { featured: true, scopeExact: true, excludeDemo: true })).toEqual({ sort: "deadline", featured: true, scope_exact: true, exclude_demo: true });
  });
});
