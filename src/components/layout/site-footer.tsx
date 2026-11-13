import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { isDemoContentEnabled } from "@/lib/env";
import { AuthLinks } from "./auth-links";
import { Container } from "./container";
import { LanguageSwitcher } from "./language-switcher";
import { Logo } from "./logo";
import { navItems } from "./navigation-items";

const linkClass = "inline-flex min-h-9 items-center text-sm text-muted-foreground hover:text-primary hover:underline";

export async function SiteFooter() {
  const t = await getTranslations();
  const format = await getFormatter();
  const year = format.number(new Date().getFullYear(), "plain");

  return (
    <footer className="border-t bg-surface">
      <Container className="grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div className="space-y-4 sm:col-span-2 lg:col-span-1">
          <Logo />
          <p className="max-w-sm text-sm text-muted-foreground">{t("footer.tagline")}</p>
        </div>
        <nav aria-label={t("footer.platform")}>
          <h2 className="mb-3 text-sm font-semibold">{t("footer.platform")}</h2>
          <ul className="space-y-0.5">
            {navItems.map(({ href, labelKey }) => (
              <li key={href}>
                <Link href={href} className={linkClass}>
                  {t(`nav.${labelKey}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label={t("footer.account")}>
          <h2 className="mb-3 text-sm font-semibold">{t("footer.account")}</h2>
          <ul className="space-y-0.5">
            <AuthLinks variant="footer" />
          </ul>
        </nav>
        <div>
          <h2 className="mb-3 text-sm font-semibold">{t("footer.language")}</h2>
          <LanguageSwitcher placement="footer" />
        </div>
      </Container>
      <div className="border-t">
        <Container className="flex flex-col gap-1 py-5 text-xs text-muted-foreground sm:flex-row sm:justify-between sm:gap-6">
          <p>{t("footer.rights", { year })}</p>
          <p className="sm:max-w-xl sm:text-right">
            {t("footer.disclaimer")}
            {/* Only while demo records can actually be shown (SHOW_DEMO_CONTENT). */}
            {isDemoContentEnabled() && ` ${t("footer.demoNote")}`}
          </p>
        </Container>
      </div>
    </footer>
  );
}
