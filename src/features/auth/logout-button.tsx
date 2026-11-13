"use client";

import { Button, type ButtonProps } from "@/components/ui/button";
import { resetPlan } from "@/features/plan/plan-store";
import { logoutAction } from "./actions";

/** Logout is a POST (server action). The browser-side plan cache is cleared first so the next person on this browser never sees it. */
export function LogoutButton({ children, className, ...props }: Omit<ButtonProps, "type" | "onClick">) {
  return (
    <form
      action={async () => {
        resetPlan();
        await logoutAction();
      }}
      className="contents"
    >
      <Button type="submit" className={className} {...props}>
        {children}
      </Button>
    </form>
  );
}
