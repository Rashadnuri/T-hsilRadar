"use client";

import { useId, useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  EDUCATION_LEVELS, FIELDS_OF_STUDY, FUNDING_TYPES, LOCATION_TYPES, OPPORTUNITY_TYPES, VERIFICATION_FILTERS, DEADLINE_FILTERS,
} from "@/types/opportunity";
import type { OpportunityFilters } from "@/validation/opportunity-filters";
import type { SelectGroup, SelectOption } from "./filter-options";

interface FilterPanelProps {
  values: OpportunityFilters;
  activeCount: number;
  countries: SelectOption[];
  cityGroups: SelectGroup[];
}

/**
 * Lives inside the catalogue <form>. On `lg+` it is a sticky sidebar; below that it collapses
 * behind a toggle. Collapsed fields stay in the DOM, so they still submit. The Azerbaijan /
 * International split has its own tabs; its value rides along as a hidden field so applying
 * filters never silently drops it.
 */
export function FilterPanel({ values, activeCount, countries, cityGroups }: FilterPanelProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const select = (name: string, label: string, current: string | undefined, children: React.ReactNode) => (
    <div>
      <Label htmlFor={`${panelId}-${name}`}>{label}</Label>
      <Select id={`${panelId}-${name}`} name={name} defaultValue={current ?? ""}>
        <option value="">{t("filters.any")}</option>
        {children}
      </Select>
    </div>
  );
  const options = (items: readonly string[], label: (v: string) => string) =>
    items.map((v) => (
      <option key={v} value={v}>
        {label(v)}
      </option>
    ));

  return (
    <aside aria-label={t("filters.title")} className="lg:sticky lg:top-24 lg:self-start">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-12 w-full items-center gap-2 rounded-xl border bg-card px-4 font-semibold text-primary shadow-card lg:hidden"
      >
        <SlidersHorizontal className="size-4" aria-hidden="true" />
        <span className="flex-1 text-left">{t("filters.title")}</span>
        {activeCount > 0 && <Badge variant="accent">{activeCount}</Badge>}
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>

      <div id={panelId} className={cn("mt-3 lg:mt-0 lg:block", open ? "block" : "hidden")}>
        <div className="space-y-4 rounded-2xl border bg-card p-5 shadow-card lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto">
          <h2 className="hidden items-center gap-2 text-base font-semibold lg:flex">
            <SlidersHorizontal className="size-4 text-accent" aria-hidden="true" />
            {t("filters.title")}
          </h2>
          {values.scope && <input type="hidden" name="scope" value={values.scope} />}

          {select("type", t("filters.type"), values.type, options(OPPORTUNITY_TYPES, (v) => t(`opportunityTypes.${v as (typeof OPPORTUNITY_TYPES)[number]}`)))}
          {select("country", t("filters.country"), values.country,
            countries.map((c) => (<option key={c.value} value={c.value}>{c.label}</option>)))}
          {select("city", t("filters.city"), values.city,
            cityGroups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((c) => (<option key={c.value} value={c.value}>{c.label}</option>))}
              </optgroup>
            )))}
          {select("level", t("filters.level"), values.level, options(EDUCATION_LEVELS, (v) => t(`level.${v as (typeof EDUCATION_LEVELS)[number]}`)))}
          {select("field", t("filters.field"), values.field, options(FIELDS_OF_STUDY, (v) => t(`fields.${v as (typeof FIELDS_OF_STUDY)[number]}`)))}
          {select("funding", t("filters.funding"), values.funding, options(FUNDING_TYPES, (v) => t(`funding.${v as (typeof FUNDING_TYPES)[number]}`)))}
          {select("location", t("filters.locationType"), values.location, options(LOCATION_TYPES, (v) => t(`locationType.${v as (typeof LOCATION_TYPES)[number]}`)))}
          {select("deadline", t("filters.deadline"), values.deadline, options(DEADLINE_FILTERS, (v) => t(`deadlineFilter.${v as (typeof DEADLINE_FILTERS)[number]}`)))}
          {select("verification", t("filters.verification"), values.verification, options(VERIFICATION_FILTERS, (v) => t(`verification.${v as (typeof VERIFICATION_FILTERS)[number]}`)))}

          {/* `flex-1` only where the buttons sit side by side: in a column it would collapse their height to the text (20 px). */}
          <div className="flex flex-col gap-3 pt-2 sm:flex-row lg:flex-col xl:flex-row">
            <Button type="submit" className="min-h-12 text-base sm:flex-1 lg:min-h-11 lg:flex-none lg:text-sm xl:flex-1">
              {t("filters.apply")}
            </Button>
            <Button asChild type="button" variant="outline" className="min-h-12 text-base sm:flex-1 lg:min-h-11 lg:flex-none lg:text-sm xl:flex-1">
              <Link href="/opportunities">{t("filters.reset")}</Link>
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
