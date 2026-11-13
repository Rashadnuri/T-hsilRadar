import { getTranslations } from "next-intl/server";
import { AuthLinks } from "./auth-links";
import { Container } from "./container";
import { LanguageSwitcher } from "./language-switcher";
import { Logo } from "./logo";
import { MobileNav } from "./mobile-nav";
import { NavLinks } from "./nav-links";

/**
 * Below `lg` the links collapse into the menu (tablets included, because Russian labels are long);
 * the language switcher stays visible at every width so switching never needs the menu.
 */
export async function Navbar() {
  const t = await getTranslations("nav");
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <Container className="relative flex h-16 items-center justify-between gap-2">
        <Logo />
        <nav aria-label={t("label")} className="hidden lg:block">
          <NavLinks />
        </nav>
        <div className="flex items-center gap-1 sm:gap-2">
          <LanguageSwitcher />
          <AuthLinks variant="desktop" />
          <MobileNav />
        </div>
      </Container>
    </header>
  );
}
