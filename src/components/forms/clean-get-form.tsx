"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

interface CleanGetFormProps extends Omit<React.ComponentProps<"form">, "action" | "method" | "onSubmit"> {
  /** Locale-less target path. */
  path?: string;
}

/**
 * GET form that works without JavaScript (plain query-string submit) and, with JavaScript,
 * navigates client-side to a clean URL: empty fields and `page` are dropped, so shared links
 * look like /az/opportunities?type=scholarship rather than ?q=&type=scholarship&level=…
 * Fields outside the <form> element are included when they use the `form` attribute.
 */
export function CleanGetForm({ path = "/opportunities", className, children, ...props }: CleanGetFormProps) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("catalogue");
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (typeof value === "string" && value.trim() !== "" && key !== "page") params.append(key, value.trim());
    }
    const query = params.toString();
    startTransition(() => router.push(query ? `${path}?${query}` : path));
  }

  return (
    // `group` + data-pending let the results dim while the next page loads (see the catalogue page).
    <form action={`/${locale}${path}`} method="get" onSubmit={onSubmit} data-pending={pending ? "true" : undefined} aria-busy={pending} className={cn("group", className)} {...props}>
      {children}
      <p role="status" className="sr-only">
        {pending ? t("updating") : ""}
      </p>
    </form>
  );
}
