"use client";

import { Suspense, useEffect, useSyncExternalStore } from "react";
import { ArrowLeft } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

/**
 * "Preserve filters when navigating": the catalogue remembers its last URL (locale-less, so it
 * survives a language switch) and the detail page's back link returns to exactly that list —
 * same filters, same page — instead of the unfiltered catalogue.
 */
const KEY = "tahsilradar:catalogue";
const FALLBACK = "/opportunities";

/** Only ever accept our own catalogue paths from storage. */
const isCataloguePath = (value: string) => /^\/opportunities(\?[^#\s]*)?$/.test(value);

function Remember() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, search ? `${pathname}?${search}` : pathname);
    } catch {
      // Storage unavailable (private mode): the back link simply falls back to the full catalogue.
    }
  }, [pathname, search]);
  return null;
}

/** Render on the catalogue page. */
export function CatalogueMemory() {
  return (
    <Suspense fallback={null}>
      <Remember />
    </Suspense>
  );
}

const subscribe = () => () => {};
function readStored(): string {
  try {
    const stored = sessionStorage.getItem(KEY) ?? "";
    return isCataloguePath(stored) ? stored : "";
  } catch {
    return "";
  }
}

/** Render on the detail page. */
export function BackToCatalogue() {
  const t = useTranslations("detail");
  const href = useSyncExternalStore(subscribe, readStored, () => "");
  return (
    <Link href={href || FALLBACK} className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-accent hover:underline">
      <ArrowLeft className="size-4" aria-hidden="true" />
      {t("back")}
    </Link>
  );
}
