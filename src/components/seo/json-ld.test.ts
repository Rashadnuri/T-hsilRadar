import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JsonLd } from "./json-ld";

describe("JsonLd", () => {
  it("renders valid JSON inside one script element", () => {
    const html = renderToStaticMarkup(createElement(JsonLd, { data: { "@type": "WebSite", name: "TəhsilRadar" } }));
    expect(html.startsWith('<script type="application/ld+json">')).toBe(true);
    expect(JSON.parse(html.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""))).toEqual({ "@type": "WebSite", name: "TəhsilRadar" });
  });

  it("a value containing markup cannot close the script element", () => {
    const html = renderToStaticMarkup(createElement(JsonLd, { data: { name: "x</script><img src=x onerror=alert(1)>" } }));
    expect(html.match(/<\/script>/g)).toHaveLength(1); // only our own closing tag
    expect(html.endsWith("</script>")).toBe(true);
  });
});
