import { describe, expect, it } from "vitest";
import { getContactEmail, mailtoHref } from "./contact";

const get = (v: string | undefined) => getContactEmail({ NEXT_PUBLIC_CONTACT_EMAIL: v });

describe("getContactEmail", () => {
  it("accepts a normal address and trims it", () => {
    expect(get("  info@tahsilradar.az ")).toBe("info@tahsilradar.az");
    expect(get("first.last+tag@mail.example-org.co.uk")).toBe("first.last+tag@mail.example-org.co.uk");
  });
  it("returns null when unset or empty", () => {
    expect(get(undefined)).toBeNull();
    expect(get("")).toBeNull();
    expect(get("   ")).toBeNull();
  });
  it("rejects placeholders from templates and documentation", () => {
    for (const v of ["your-email@domain.az", "name@example.com", "a@example.org", "x@localhost.test", "<email>", "changeme@x.az"]) expect(get(v), v).toBeNull();
  });
  it("rejects malformed values and anything that could inject into a link or header", () => {
    for (const v of ["plain", "a@b", "a@@b.az", "a b@c.az", "a@b.az, c@d.az", "a@b.az\nBcc: x@y.az", "<a@b.az>", "a@b.az?subject=x", 'a"@b.az', "a@-b.az", "a@b..az", `${"a".repeat(250)}@b.az`]) {
      expect(get(v), JSON.stringify(v)).toBeNull();
    }
  });
});

describe("mailtoHref", () => {
  it("encodes the subject", () => {
    expect(mailtoHref("a@b.az", "TəhsilRadar: sual & cavab")).toBe(`mailto:a@b.az?subject=${encodeURIComponent("TəhsilRadar: sual & cavab")}`);
    expect(mailtoHref("a@b.az", "x y")).toBe("mailto:a@b.az?subject=x%20y");
  });
});
