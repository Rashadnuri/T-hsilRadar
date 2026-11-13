import { Radar } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function Logo() {
  const t = await getTranslations();
  return (
    <Link
      href="/"
      aria-label={t("header.home")}
      className="inline-flex items-center gap-2 rounded-md text-base font-bold tracking-tight sm:text-lg text-primary"
    >
      <span className="grid size-8 place-items-center sm:size-9 rounded-lg bg-primary text-primary-foreground">
        <Radar className="size-5" aria-hidden="true" />
      </span>
      <span>{t("common.siteName")}</span>
    </Link>
  );
}
