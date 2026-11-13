"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { navItems } from "./navigation-items";

interface NavLinksProps {
  orientation?: "horizontal" | "vertical";
  onNavigate?: () => void;
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Locale-aware links; `usePathname` from next-intl returns the path without the locale prefix. */
export function NavLinks({ orientation = "horizontal", onNavigate }: NavLinksProps) {
  const t = useTranslations("nav");
  const pathname = usePathname();

  return (
    <ul className={cn("flex gap-1", orientation === "vertical" ? "flex-col" : "items-center")}>
      {navItems.map(({ href, labelKey }) => {
        const active = isActive(pathname, href);
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium transition-colors",
                orientation === "vertical" && "w-full text-base",
                active ? "bg-secondary text-primary" : "text-muted-foreground hover:bg-secondary hover:text-primary",
              )}
            >
              {t(labelKey)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
