"use client";

import { useState, useTransition } from "react";
import { CheckCheck, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { deleteSourceAction, markSourceCheckedAction } from "./import-actions";

/** "I opened the official page and checked it" (records the date) and delete. The platform never checks a site by itself. */
export function SourceActions({ id }: { id: string }) {
  const t = useTranslations("admin.sources");
  const tErr = useTranslations("admin.errors");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (work: () => Promise<{ ok: boolean; code?: string }>) =>
    startTransition(async () => {
      setError(null);
      const r = await work();
      if (!r.ok) setError(tErr((r.code ?? "failed") as never));
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" disabled={pending} data-action="mark-checked" onClick={() => run(() => markSourceCheckedAction(id))}>
        <CheckCheck aria-hidden="true" />
        {t("markChecked")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        data-action="delete-source"
        onClick={() => {
          if (!window.confirm(t("deleteConfirm"))) return;
          run(() => deleteSourceAction(id));
        }}
      >
        <Trash2 aria-hidden="true" />
        {t("delete")}
      </Button>
      {error && (
        <p role="alert" className="w-full text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
