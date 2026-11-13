"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { deleteOrganizationAction } from "./actions";

export function DeleteOrganizationButton({ id, disabled }: { id: string; disabled: boolean }) {
  const t = useTranslations("admin.orgs");
  const tErr = useTranslations("admin.errors");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending || disabled}
        title={disabled ? t("inUse") : undefined}
        data-action="delete-org"
        onClick={() => {
          if (!window.confirm(t("deleteConfirm"))) return;
          setError(null);
          startTransition(async () => {
            const r = await deleteOrganizationAction(id);
            if (!r.ok) setError(tErr((r.code ?? "failed") as never));
          });
        }}
      >
        <Trash2 aria-hidden="true" />
        {t("delete")}
      </Button>
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
