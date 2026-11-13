import { describe, expect, it } from "vitest";
import { resolveSearchTokens } from "../search-tokens";

const one = (q: string) => resolveSearchTokens(q)[0]!;

describe("resolveSearchTokens (multilingual keywords → codes the database can match)", () => {
  it("returns nothing for an empty query", () => {
    expect(resolveSearchTokens("")).toEqual([]);
    expect(resolveSearchTokens(undefined)).toEqual([]);
    expect(resolveSearchTokens("   ")).toEqual([]);
  });
  it("folds each word (case, diacritics) and keeps one token per word", () => {
    expect(resolveSearchTokens("TƏQAÜD  Баку").map((t) => t.txt)).toEqual(["teqaud", "баку"]);
  });
  it("opportunity types in any language", () => {
    expect(one("scholarship").types).toContain("scholarship");
    expect(one("стипендии").types).toContain("scholarship");
    expect(one("təqaüdlər").types).toContain("scholarship");
    expect(one("hakaton").types).toContain("hackathon");
    expect(one("internship").types).toEqual(["internship"]);
    expect(one("zzzqqq").types).toEqual([]);
  });
  it("cities in az / ru / en", () => {
    expect(one("Баку").cities).toEqual(["baku"]);
    expect(one("gence").cities).toEqual(["ganja"]);
    expect(one("Mingəçevir").cities).toEqual(["mingachevir"]);
  });
  it("countries via CLDR names in az / ru / en", () => {
    expect(one("Germany").countries).toContain("DE");
    expect(one("Германия").countries).toContain("DE");
    expect(one("Almaniya").countries).toContain("DE");
    expect(one("azerbaijan").countries).toContain("AZ");
  });
  it("location types, funding, levels and fields", () => {
    expect(one("hybrid").locations).toEqual(["hybrid"]);
    expect(one("remote").locations).toEqual(["remote"]);
    expect(one("unpaid").fundings).toContain("unpaid");
    expect(one("master").levels).toContain("master");
    expect(one("communication").fields).toEqual(["ict"]);
  });
});
