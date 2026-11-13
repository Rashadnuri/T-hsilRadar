"use client";

import { useEffect, useId, useState } from "react";
import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { usePathname } from "@/i18n/navigation";
import { AuthLinks } from "./auth-links";
import { NavLinks } from "./nav-links";

/** Disclosure-style mobile menu: button toggles a panel; closes on navigation and Escape. */
export function MobileNav() {
  const t = useTranslations("nav");
  const panelId = useId();
  const pathname = usePathname();
  // The menu is "open" only for the page it was opened on, so any navigation
  // (link click, back button) closes it without an effect.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const setOpen = (value: boolean) => setOpenAt(value ? pathname : null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setOpenAt(null);
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="lg:hidden">
      <Button
        variant="ghost"
        size="icon"
        className="size-10"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? t("closeMenu") : t("openMenu")}
        onClick={() => setOpen(!open)}
      >
        {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
      </Button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 top-full max-h-[calc(100dvh-4rem)] overflow-y-auto border-b bg-background px-4 pb-5 pt-3 shadow-card sm:px-6"
      >
        <nav aria-label={t("label")}>
          <NavLinks orientation="vertical" onNavigate={() => setOpen(false)} />
        </nav>
        <AuthLinks variant="mobile" onNavigate={() => setOpen(false)} />
      </div>
    </div>
  );
}
