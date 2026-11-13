"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/features/auth/logout-button";
import { resetPlan } from "@/features/plan/plan-store";
import { logoutAction } from "@/features/auth/actions";
import { Link } from "@/i18n/navigation";
import { AUTH_HINT_COOKIE } from "@/lib/auth/cookies";

const subscribe = (onChange: () => void) => {
  // A fresh login/logout navigates, but also re-check when the tab becomes visible again.
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
};
const readHint = () => document.cookie.split("; ").some((c) => c === `${AUTH_HINT_COOKIE}=1`);

/**
 * Login/register OR profile/logout. The decision uses the non-sensitive hint cookie so public
 * pages stay statically cached; it only picks which links to show — the server still verifies the
 * session on every protected page and action. Logging out is a POST (server action).
 */
export function AuthLinks({ variant, onNavigate }: { variant: "desktop" | "mobile" | "footer"; onNavigate?: () => void }) {
  const t = useTranslations("nav");
  const signedIn = useSyncExternalStore(subscribe, readHint, () => false);

  if (variant === "footer") {
    const cls = "inline-flex min-h-9 items-center text-sm text-muted-foreground hover:text-primary hover:underline";
    return signedIn ? (
      <>
        <li>
          <Link href="/matches" className={cls}>
            {t("matches")}
          </Link>
        </li>
        <li>
          <Link href="/my-plan" className={cls}>
            {t("myPlan")}
          </Link>
        </li>
        <li>
          <Link href="/profile" className={cls}>
            {t("profile")}
          </Link>
        </li>
        <li>
          <form
            action={async () => {
              resetPlan();
              await logoutAction();
            }}
          >
            <button type="submit" className={cls}>
              {t("logout")}
            </button>
          </form>
        </li>
      </>
    ) : (
      <>
        <li>
          <Link href="/login" className={cls}>
            {t("login")}
          </Link>
        </li>
        <li>
          <Link href="/register" className={cls}>
            {t("register")}
          </Link>
        </li>
      </>
    );
  }

  const mobile = variant === "mobile";
  const size = mobile ? "lg" : "sm";
  const wrapper = mobile ? "mt-4 grid gap-2 border-t pt-4 sm:grid-cols-3" : "ml-1 hidden items-center gap-2 lg:flex";
  return (
    <div className={wrapper}>
      {signedIn ? (
        <>
          {mobile && (
            <Button asChild variant="outline" size={size}>
              <Link href="/matches" onClick={onNavigate}>
                {t("matches")}
              </Link>
            </Button>
          )}
          <Button asChild variant={mobile ? "outline" : "ghost"} size={size}>
            <Link href="/my-plan" onClick={onNavigate}>
              {t("myPlan")}
            </Link>
          </Button>
          <Button asChild variant={mobile ? "outline" : "ghost"} size={size}>
            <Link href="/profile" onClick={onNavigate}>
              {t("profile")}
            </Link>
          </Button>
          <LogoutButton size={size} variant={mobile ? "default" : "outline"}>
            {t("logout")}
          </LogoutButton>
        </>
      ) : (
        <>
          <Button asChild variant={mobile ? "outline" : "ghost"} size={size}>
            <Link href="/login" onClick={onNavigate}>
              {t("login")}
            </Link>
          </Button>
          <Button asChild size={size}>
            <Link href="/register" onClick={onNavigate}>
              {t("register")}
            </Link>
          </Button>
        </>
      )}
    </div>
  );
}
