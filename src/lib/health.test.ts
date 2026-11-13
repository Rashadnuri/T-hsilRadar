import { describe, expect, it, vi } from "vitest";
import { buildHealth } from "./health";

const now = new Date("2026-11-13T10:00:00Z");

describe("buildHealth", () => {
  it("demo mode (no data source): ok, database skipped", async () => {
    expect(await buildHealth(null, { now })).toEqual({ httpStatus: 200, body: { status: "ok", checks: { database: "skipped" }, time: "2026-11-13T10:00:00.000Z" } });
  });
  it("healthy database: 200 / ok", async () => {
    const probe = vi.fn().mockResolvedValue([]);
    const r = await buildHealth(probe, { now });
    expect(r.httpStatus).toBe(200);
    expect(r.body.checks.database).toBe("ok");
    expect(probe).toHaveBeenCalledOnce();
  });
  it("failing database: 503, and the error text never reaches the response", async () => {
    const onError = vi.fn();
    const r = await buildHealth(() => Promise.reject(new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2")), { now, onError });
    expect(r.httpStatus).toBe(503);
    expect(r.body).toEqual({ status: "unavailable", checks: { database: "error" }, time: "2026-11-13T10:00:00.000Z" });
    expect(JSON.stringify(r.body)).not.toMatch(/ECONNREFUSED|hunter2|10\.0\.0\.5/);
    expect(onError).toHaveBeenCalledOnce(); // logged server-side only
  });
  it("a hanging database is cut off by the timeout (503, quickly)", async () => {
    const started = Date.now();
    const r = await buildHealth(() => new Promise(() => {}), { now, timeoutMs: 40 });
    expect(r.httpStatus).toBe(503);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
