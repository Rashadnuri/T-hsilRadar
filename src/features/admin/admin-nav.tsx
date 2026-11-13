"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/admin", key: "dashboard", exact: true },
  { href: "/admin/opportunities", key: "opportunities", exact: false },
  { href: "/admin/organizations", key: "organizations", exact: false },
  { href: "/admin/sources", key: "sources", exact: false },
  { href: "/admin/import", key: "import", exact: false },
  { href: "/admin/quality", key: "quality", exact: false },
] as const;

export function AdminNav() {
  const t = useTranslations("admin.nav");
  const pathname = usePathname();
  return (
    <nav aria-label={t("label")}>
      <ul className="flex flex-wrap gap-2">
        {ITEMS.map(({ href, key, exact }) => {
          const current = exact ? pathname === href : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={cn("inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium transition-colors", current ? "border-primary bg-primary text-primary-foreground" : "bg-background text-primary hover:bg-secondary")}
              >
                {t(key)}
              </Link>
            </li>
          );
        })}
        <li>
          <Link href="/" className="inline-flex min-h-10 items-center px-3 text-sm font-medium text-muted-foreground hover:text-primary hover:underline">
            {t("site")}
          </Link>
        </li>
      </ul>
    </nav>
  );
}
