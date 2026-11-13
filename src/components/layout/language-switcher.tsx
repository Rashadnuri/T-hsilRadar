"use client";

import { Suspense } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { localeMeta } from "@/i18n/locales";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { locales, type Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

interface LanguageSwitcherProps {
  className?: string;
  /** Header and footer both show a switcher; landmarks need distinct names. */
  placement?: "header" | "footer";
}

interface SwitcherLinksProps extends LanguageSwitcherProps {
  search: string;
}

function SwitcherLinks({ className, search, placement = "header" }: SwitcherLinksProps) {
  const t = useTranslations("languageSwitcher");
  const activeLocale = useLocale();
  // Locale-less path of the current page, plus its query string (filters, search, page).
  const pathname = usePathname();
  const router = useRouter();
  const href = search ? `${pathname}?${search}` : pathname;

  // The href above is for "open in new tab" / no-JS. A plain click reads the live URL instead,
  // so it keeps the query string even while the page is still streaming in (no race).
  function switchLocale(event: React.MouseEvent<HTMLAnchorElement>, locale: Locale) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    router.replace(`${pathname}${window.location.search}`, { locale });
  }

  return (
    <nav aria-label={placement === "footer" ? t("footerLabel") : t("label")} className={className}>
      <ul className="inline-flex rounded-lg border bg-background p-0.5">
        {locales.map((locale: Locale) => {
          const { code, nativeName } = localeMeta[locale];
          const isCurrent = locale === activeLocale;
          return (
            <li key={locale}>
              <Link
                href={href}
                locale={locale}
                lang={locale}
                hrefLang={locale}
                onClick={(event) => switchLocale(event, locale)}
                prefetch={false}
                aria-current={isCurrent ? "true" : undefined}
                aria-label={t("switchTo", { language: nativeName })}
                title={nativeName}
                className={cn(
                  "inline-flex min-h-10 min-w-10 items-center justify-center rounded-md px-2 text-sm font-semibold transition-colors sm:min-w-11 sm:px-2.5",
                  isCurrent ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-primary",
                )}
              >
                {code}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SwitcherWithSearch(props: LanguageSwitcherProps) {
  const search = useSearchParams().toString();
  return <SwitcherLinks {...props} search={search} />;
}

/**
 * Switches the UI language while staying on the same page and keeping the query string.
 * Plain links (no JS required to navigate); `useSearchParams` sits behind Suspense so
 * statically rendered pages keep working — the fallback renders the same links without a query.
 */
export function LanguageSwitcher(props: LanguageSwitcherProps) {
  return (
    <Suspense fallback={<SwitcherLinks {...props} search="" />}>
      <SwitcherWithSearch {...props} />
    </Suspense>
  );
}
