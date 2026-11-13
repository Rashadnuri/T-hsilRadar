"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Container } from "@/components/layout/container";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Segment-level error boundary: header and footer stay visible, the user can retry. */
export default function ErrorPage({ error, reset }: ErrorProps) {
  const t = useTranslations();

  useEffect(() => {
    // Replace with Sentry (or similar) once monitoring is set up. Do not log user data.
    console.error(error);
  }, [error]);

  return (
    <Container className="grid place-items-center py-20 text-center sm:py-28">
      <div role="alert" className="max-w-md">
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-secondary text-destructive">
          <TriangleAlert className="size-6" aria-hidden="true" />
        </span>
        <h1 className="text-3xl font-bold">{t("error.title")}</h1>
        <p className="mt-3 text-muted-foreground">{t("error.text")}</p>
        {error.digest && <p className="mt-2 text-xs text-muted-foreground">{t("error.reference", { digest: error.digest })}</p>}
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button onClick={reset}>{t("common.tryAgain")}</Button>
          <Button asChild variant="outline">
            <Link href="/">{t("common.backToHome")}</Link>
          </Button>
        </div>
      </div>
    </Container>
  );
}
