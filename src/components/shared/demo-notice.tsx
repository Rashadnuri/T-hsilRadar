import { FlaskConical } from "lucide-react";
import { getTranslations } from "next-intl/server";

/** Visible on every surface that shows demo records (PRODUCT_SPEC §3: demo must be labelled). */
export async function DemoNotice({ className = "" }: { className?: string }) {
  const t = await getTranslations("demo");
  return (
    <div role="note" className={`flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 ${className}`}>
      <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>
        <strong className="font-semibold">{t("title")}</strong> {t("text")}
      </p>
    </div>
  );
}
