"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { expireCheckAction } from "./import-actions";

export function ExpireCheckButton({ pending: waiting }: { pending: number }) {
  const t = useTranslations("admin.quality.expire");
  const tErr = useTranslations("admin.errors");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  return (
    <div>
      <Button
        type="button"
        disabled={pending}
        data-action="expire-check"
        onClick={() =>
          startTransition(async () => {
            const r = await expireCheckAction();
            setMessage(r.ok ? { kind: "ok", text: t("result", { count: r.flagged }) } : { kind: "error", text: tErr(r.code as never) });
          })
        }
      >
        {pending ? t("working") : t("button")}
      </Button>
      <p className="mt-2 text-sm text-muted-foreground" data-testid="expire-pending">
        {t("pending", { count: waiting })}
      </p>
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "mt-2 text-sm text-destructive" : "mt-2 text-sm text-primary"} data-testid="expire-result">
          {message.text}
        </p>
      )}
    </div>
  );
}
