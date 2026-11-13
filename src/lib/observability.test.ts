import { describe, expect, it } from "vitest";
import { describeRequestError, redact } from "./observability";

const ctx = { routerKind: "App Router", routePath: "/[locale]/opportunities", routeType: "render", renderSource: "react-server-components" };

describe("describeRequestError", () => {
  it("records what is needed to find the failure", () => {
    const e = Object.assign(new TypeError("fetch failed"), { digest: "163644075" });
    expect(describeRequestError(e, { path: "/en/opportunities", method: "GET" }, ctx)).toMatchObject({
      level: "error", event: "request_error", name: "TypeError", message: "fetch failed", digest: "163644075", method: "GET", path: "/en/opportunities", routePath: "/[locale]/opportunities", routeType: "render",
    });
  });
  it("strips the query string and fragment (one-time codes, search terms)", () => {
    expect(describeRequestError(new Error("x"), { path: "/en/auth/callback?code=SECRETCODE&next=/profile#frag", method: "GET" }, ctx).path).toBe("/en/auth/callback");
  });
  it("contains no headers, cookies or other request data, even if they are passed in", () => {
    const rec = describeRequestError(new Error("x"), { path: "/a", method: "POST", headers: { cookie: "sb-session=abc", authorization: "Bearer zzz" } } as never, ctx);
    expect(JSON.stringify(rec)).not.toMatch(/cookie|sb-session|authorization|zzz/i);
  });
  it("redacts keys, tokens and e-mail addresses inside the message, and caps its length", () => {
    const jwt = ["eyJhbGciOiJIUzI1NiJ9", Buffer.from('{"role":"anon"}').toString("base64url"), "c2lnbmF0dXJl"].join("."); // built at runtime: no secret-looking literal in the repo
    const m = describeRequestError(new Error(`bad ${jwt} sk-ant-api03-abcdef user a.b@mail.az token=xyz ${"x".repeat(500)}`), { path: "/", method: "GET" }, ctx).message;
    expect(m).not.toMatch(/eyJ|sk-ant|a\.b@mail\.az|token=xyz/);
    expect(m).toContain("[redacted]");
    expect(m).toContain("[email]");
    expect(m.length).toBeLessThanOrEqual(300);
  });
  it("copes with non-Error values", () => {
    expect(describeRequestError("boom", { path: "/", method: "GET" }, ctx)).toMatchObject({ name: "Error", message: "boom", digest: undefined });
    expect(describeRequestError(null, {}, {}).path).toBe("");
  });
});

describe("redact", () => {
  it("leaves harmless text alone", () => {
    expect(redact("Supabase catalogue_facets failed: TypeError: fetch failed")).toBe("Supabase catalogue_facets failed: TypeError: fetch failed");
  });
});
