"use client";

import { useId, useState } from "react";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ErrorText } from "@/features/auth/form-parts";
import { LANGUAGE_LEVELS, type LanguageLevel } from "@/types/profile";

interface Option {
  value: string;
  label: string;
}

function Chip({ label, removeLabel, onRemove }: { label: string; removeLabel: string; onRemove: () => void }) {
  return (
    <li className="inline-flex max-w-full items-center gap-1 rounded-full border bg-secondary py-1 pl-3 pr-1 text-sm text-primary">
      <span className="truncate">{label}</span>
      <button type="button" onClick={onRemove} aria-label={removeLabel} className="grid size-6 shrink-0 place-items-center rounded-full hover:bg-background">
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </li>
  );
}

interface TagInputProps {
  name: string;
  label: string;
  hint: string;
  values: string[];
  onChange: (values: string[]) => void;
  max: number;
  maxLength: number;
  error?: string;
}

/** Free-text tags (skills, interests). Enter/comma/leaving the box adds the text; each tag is posted as its own field. */
export function TagInput({ name, label, hint, values, onChange, max, maxLength, error }: TagInputProps) {
  const t = useTranslations("profile.tags");
  const id = useId();
  const [draft, setDraft] = useState("");

  function commit() {
    const value = draft.replace(/\s+/g, " ").trim();
    setDraft("");
    if (!value || values.some((v) => v.toLocaleLowerCase() === value.toLocaleLowerCase()) || values.length >= max) return;
    onChange([...values, value]);
  }

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <ul className="mb-2 flex flex-wrap gap-2">
        {values.map((value, i) => (
          <Chip key={value} label={value} removeLabel={t("remove", { item: value })} onRemove={() => onChange(values.filter((_, j) => j !== i))} />
        ))}
      </ul>
      {values.map((value) => (
        <input key={value} type="hidden" name={name} value={value} />
      ))}
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          maxLength={maxLength + 20}
          aria-describedby={`${id}-hint`}
          aria-invalid={!!error}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              commit();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={commit} className="shrink-0">
          {t("add")}
        </Button>
      </div>
      <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted-foreground">
        {hint}
      </p>
      <ErrorText id={`${id}-err`} message={error} />
    </div>
  );
}

interface CountryPickerProps {
  name: string;
  label: string;
  hint: string;
  options: Option[];
  values: string[];
  onChange: (values: string[]) => void;
  max: number;
  placeholder: string;
  error?: string;
}

export function CountryPicker({ name, label, hint, options, values, onChange, max, placeholder, error }: CountryPickerProps) {
  const t = useTranslations("profile.tags");
  const id = useId();
  const [choice, setChoice] = useState("");
  const labelOf = (code: string) => options.find((o) => o.value === code)?.label ?? code;

  function add() {
    if (!choice || values.includes(choice) || values.length >= max) return;
    onChange([...values, choice]);
    setChoice("");
  }

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <ul className="mb-2 flex flex-wrap gap-2">
        {values.map((code) => (
          <Chip key={code} label={labelOf(code)} removeLabel={t("remove", { item: labelOf(code) })} onRemove={() => onChange(values.filter((c) => c !== code))} />
        ))}
      </ul>
      {values.map((code) => (
        <input key={code} type="hidden" name={name} value={code} />
      ))}
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <Select id={id} value={choice} onChange={(event) => setChoice(event.target.value)} aria-describedby={`${id}-hint`}>
            <option value="">{placeholder}</option>
            {options
              .filter((o) => !values.includes(o.value))
              .map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
          </Select>
        </div>
        <Button type="button" variant="outline" onClick={add} className="shrink-0">
          {t("add")}
        </Button>
      </div>
      <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted-foreground">
        {hint}
      </p>
      <ErrorText id={`${id}-err`} message={error} />
    </div>
  );
}

export interface LanguageRow {
  code: string;
  level: LanguageLevel | "";
}

interface LanguageRowsProps {
  label: string;
  options: Option[];
  rows: LanguageRow[];
  onChange: (rows: LanguageRow[]) => void;
  max: number;
  error?: string;
}

export function LanguageRows({ label, options, rows, onChange, max, error }: LanguageRowsProps) {
  const t = useTranslations("profile");
  const id = useId();
  const update = (i: number, patch: Partial<LanguageRow>) => onChange(rows.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-primary">{label}</legend>
      {rows.length === 0 && <p className="mb-2 text-sm text-muted-foreground">{t("languagesField.none")}</p>}
      <div className="space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <div>
              <Label htmlFor={`${id}-c${i}`}>{t("languagesField.language")}</Label>
              <Select id={`${id}-c${i}`} name="languageCode" value={row.code} onChange={(event) => update(i, { code: event.target.value })}>
                <option value="">{t("choose")}</option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`${id}-l${i}`}>{t("languagesField.level")}</Label>
              <Select id={`${id}-l${i}`} name="languageLevel" value={row.level} onChange={(event) => update(i, { level: event.target.value as LanguageLevel | "" })}>
                <option value="">{t("choose")}</option>
                {LANGUAGE_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {t(`languageLevels.${level}`)}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="button" variant="outline" size="icon" aria-label={t("languagesField.remove")} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              <X aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>
      <ErrorText id={`${id}-err`} message={error} />
      {rows.length < max && (
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => onChange([...rows, { code: "", level: "" }])}>
          <Plus aria-hidden="true" />
          {t("languagesField.add")}
        </Button>
      )}
    </fieldset>
  );
}
