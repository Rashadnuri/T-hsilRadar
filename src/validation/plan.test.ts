import { describe, expect, it } from "vitest";
import { PLAN_LIMITS } from "@/types/plan";
import { parseApplicationUpdate, parseOpportunityId } from "./plan";

const form = (values: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
};

describe("opportunity ids", () => {
  it("accepts uuids and demo ids", () => {
    expect(parseOpportunityId("0b5d2b1e-8d0e-4c7e-9a41-0123456789ab")).toBe("0b5d2b1e-8d0e-4c7e-9a41-0123456789ab");
    expect(parseOpportunityId("demo-merit-scholarship")).toBe("demo-merit-scholarship");
    expect(parseOpportunityId("  abc ")).toBe("abc");
  });
  it.each([["empty", ""], ["non-string", 42], ["null", null], ["too long", "a".repeat(65)], ["quote", "a'b"], ["space", "a b"], ["slash", "../x"], ["sql", "1; drop table applications"], ["leading dash", "-x"]])("rejects %s", (_n, value) => {
    expect(parseOpportunityId(value)).toBeNull();
  });
});

describe("application update form", () => {
  const ok = { opportunityId: "demo-x", status: "applied", notes: "  Ask for a reference  " };

  it("parses, trimming the notes", () => {
    expect(parseApplicationUpdate(form(ok))).toEqual({ ok: true, value: { opportunityId: "demo-x", status: "applied", notes: "Ask for a reference" } });
  });
  it("turns blank notes into null", () => {
    const r = parseApplicationUpdate(form({ ...ok, notes: "   \n " }));
    expect(r.ok && r.value.notes).toBeNull();
    const r2 = parseApplicationUpdate(form({ opportunityId: "demo-x", status: "interview" }));
    expect(r2.ok && r2.value.notes).toBeNull();
  });
  it("accepts all seven statuses and nothing else", () => {
    for (const s of ["interested", "preparing", "applied", "interview", "accepted", "rejected", "withdrawn"]) expect(parseApplicationUpdate(form({ ...ok, status: s })).ok).toBe(true);
    for (const s of ["", "ghosted", "APPLIED", "applied ", "interested,applied"]) {
      const r = parseApplicationUpdate(form({ ...ok, status: s }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.status?.code).toBe("invalid_choice");
    }
  });
  it("caps the notes length with a localisable code and the limit as parameter", () => {
    expect(parseApplicationUpdate(form({ ...ok, notes: "x".repeat(PLAN_LIMITS.notesMax) })).ok).toBe(true);
    const r = parseApplicationUpdate(form({ ...ok, notes: "x".repeat(PLAN_LIMITS.notesMax + 1) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.notes).toEqual({ code: "text_too_long", params: { max: PLAN_LIMITS.notesMax } });
  });
  it("keeps notes as plain text (HTML is stored as typed and escaped when shown)", () => {
    const r = parseApplicationUpdate(form({ ...ok, notes: "<b>call</b> them" }));
    expect(r.ok && r.value.notes).toBe("<b>call</b> them");
  });
  it("rejects a bad opportunity id", () => {
    const r = parseApplicationUpdate(form({ ...ok, opportunityId: "x'; --" }));
    expect(r.ok).toBe(false);
  });
  it("ignores any user id supplied by the browser", () => {
    const r = parseApplicationUpdate(form({ ...ok, userId: "someone-else", user_id: "someone-else" }));
    expect(r.ok && Object.keys(r.value).sort()).toEqual(["notes", "opportunityId", "status"]);
  });
});
