import { notFound } from "next/navigation";

// Any unmatched path under /{locale}/… renders the localized not-found page
// (with header, footer and the correct <html lang>).
export default function CatchAllPage() {
  notFound();
}
