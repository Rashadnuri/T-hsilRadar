import { describe, expect, it } from "vitest";
import { formatDateTimeInZone } from "./format";

const instant = "2027-03-01T19:59:59.999Z"; // end of 1 March in Baku (UTC+4)

describe("formatDateTimeInZone", () => {
  it.each([
    ["az", /1 mart 2027/],
    ["ru", /1 марта 2027/],
    ["en", /March 1, 2027/],
  ] as const)("renders a localized date in %s with the zone, not Date#toString()", (locale, date) => {
    const out = formatDateTimeInZone(instant, locale, "Asia/Baku");
    expect(out).toMatch(date);
    expect(out).toMatch(/\+4/); // zone label
    expect(out).not.toMatch(/Coordinated Universal Time|GMT\+0000/);
  });
  it("converts to the organization's zone (UTC 19:59 → next-day 00:59 in Istanbul? no: UTC+3 → 22:59)", () => {
    expect(formatDateTimeInZone(instant, "en", "Europe/Istanbul")).toMatch(/10:59/);
  });
});
