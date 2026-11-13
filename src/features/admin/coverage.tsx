import { getTranslations } from "next-intl/server";
import { translationSlots, type TranslationSlotState } from "@/lib/admin/form-values";
import { TRANSLATION_LANGUAGES } from "@/types/admin";
import type { OpportunityRecord } from "@/types/opportunity";
import { cn } from "@/lib/utils";

const STYLE: Record<TranslationSlotState, string> = {
  original: "border-primary bg-primary text-primary-foreground",
  human: "border-emerald-300 bg-emerald-50 text-emerald-900",
  machine_approved: "border-emerald-300 bg-emerald-50 text-emerald-900",
  machine_draft: "border-amber-300 bg-amber-50 text-amber-900",
  outdated: "border-amber-300 bg-amber-50 text-amber-900",
  missing: "border-dashed border-slate-300 bg-muted text-muted-foreground",
};

/** AZ / RU / EN at a glance: which translations exist, which are drafts, which are missing. */
export async function TranslationCoverage({ record }: { record: Pick<OpportunityRecord, "translations" | "originalLanguage"> }) {
  const t = await getTranslations("admin");
  const slots = translationSlots(record, TRANSLATION_LANGUAGES);
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t("coverage.legend")} data-testid="coverage">
      {slots.map(({ language, state }) => (
        <li key={language} data-language={language} data-state={state} className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold", STYLE[state])} title={t(`tr.states.${state}` as never)}>
          <span>{language.toUpperCase()}</span>
          <span className="font-normal">{t(`tr.states.${state}` as never)}</span>
        </li>
      ))}
    </ul>
  );
}
