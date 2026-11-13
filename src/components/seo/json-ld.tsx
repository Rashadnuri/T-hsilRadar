/**
 * schema.org structured data as <script type="application/ld+json">. The data is passed as a text
 * child, never through dangerouslySetInnerHTML: React neutralises "</script" inside script text,
 * so even a value containing markup cannot end the element.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json">{JSON.stringify(data)}</script>;
}
