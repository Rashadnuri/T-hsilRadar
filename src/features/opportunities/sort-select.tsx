"use client";

import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { SortOption } from "@/types/opportunity";

interface SortSelectProps {
  value: SortOption;
  /** "relevance" is only offered (and is the default) when a search query exists. */
  hasQuery: boolean;
}

/** Submits the surrounding catalogue form on change (and still works with the Apply button without JS). */
export function SortSelect({ value, hasQuery }: SortSelectProps) {
  const t = useTranslations("sort");
  const options: SortOption[] = hasQuery ? ["relevance", "deadline", "newest", "updated"] : ["deadline", "newest", "updated"];
  // The default sort submits an empty value, which the form drops, keeping shared URLs clean.
  const defaultOption = options[0];
  const submitValue = (option: SortOption) => (option === defaultOption ? "" : option);
  return (
    <div className="flex items-center gap-2 sm:min-w-72">
      <Label htmlFor="sort-select" className="mb-0 shrink-0 text-muted-foreground">
        {t("label")}
      </Label>
      <Select id="sort-select" name="sort" defaultValue={submitValue(value)} onChange={(event) => event.currentTarget.form?.requestSubmit()}>
        {options.map((option) => (
          <option key={option} value={submitValue(option)}>
            {t(option)}
          </option>
        ))}
      </Select>
    </div>
  );
}
