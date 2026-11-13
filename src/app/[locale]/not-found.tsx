import { getTranslations } from "next-intl/server";
import { Container } from "@/components/layout/container";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

export default async function NotFound() {
  const t = await getTranslations();
  return (
    <Container className="grid place-items-center py-20 text-center sm:py-28">
      <div className="max-w-md">
        <p className="text-6xl font-bold text-accent" aria-hidden="true">
          {t("notFound.code")}
        </p>
        <h1 className="mt-4 text-3xl font-bold">{t("notFound.title")}</h1>
        <p className="mt-3 text-muted-foreground">{t("notFound.text")}</p>
        <Button asChild className="mt-8" size="lg">
          <Link href="/">{t("common.backToHome")}</Link>
        </Button>
      </div>
    </Container>
  );
}
