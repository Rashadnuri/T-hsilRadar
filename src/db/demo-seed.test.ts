import { describe, expect, it } from "vitest";
import { getDemoRecords } from "@/features/opportunities/demo-data";
import { demoUuid, generateDemoSeedSql } from "./demo-seed";

describe("demo seed generator", () => {
  it("demoUuid is a stable, valid version-5 style UUID", () => {
    expect(demoUuid("demo-01")).toBe(demoUuid("demo-01"));
    expect(demoUuid("demo-01")).not.toBe(demoUuid("demo-02"));
    expect(demoUuid("demo-01")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("emits one transaction with relative timestamps, flagged demo and never verified", () => {
    const sql = generateDemoSeedSql(getDemoRecords(), Date.parse("2026-11-12T00:00:00Z"));
    expect(sql).toMatch(/^-- DEMO SEED/);
    expect(sql).toContain("\nbegin;\n");
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(sql).toContain("now() + interval '");
    expect(sql).not.toMatch(/'verified'/); // demo data is never verified
    expect(sql.match(/insert into public\.opportunities /g)).toHaveLength(22);
    expect(sql.match(/insert into public\.organizations /g)!.length).toBeGreaterThan(15);
  });
  it("escapes quotes in text (no SQL injection through content)", () => {
    const [record] = getDemoRecords();
    const evil = { ...record!, translations: record!.translations.map((t, i) => (i === 0 ? { ...t, title: "O'Brien'); drop table public.opportunities; --" } : t)) };
    const sql = generateDemoSeedSql([evil]);
    expect(sql).toContain("'O''Brien''); drop table public.opportunities; --'");
  });
});
