"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FieldError } from "@/validation/messages";
import type { FormState } from "./state";

/** Localised text for a validation error code (+ numeric params). Never shows a raw code. */
export function useFieldErrorText() {
  const t = useTranslations("validation");
  return (error: FieldError | undefined) => (error ? t(error.code, error.params ?? {}) : undefined);
}

/** The error summary above a form: neutral, localised, announced to screen readers. */
export function FormAlert({ state }: { state: FormState }) {
  const t = useTranslations("authErrors");
  if (state.status !== "error" || !state.formError) return null;
  return (
    <p role="alert" className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-sm text-destructive">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {t(state.formError)}
    </p>
  );
}

/** The invalid control this message belongs to: the nearest preceding sibling (or its descendant) flagged aria-invalid. */
function findInvalidControl(message: HTMLElement): HTMLElement | null {
  for (let sibling = message.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
    const control = sibling.matches('[aria-invalid="true"]') ? (sibling as HTMLElement) : sibling.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (control) return control;
  }
  return message.parentElement?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? null;
}

/**
 * A field's validation message. Besides showing it, it links itself to its control with
 * aria-describedby, so a screen reader reads "Email, invalid, This field is required" together.
 */
export function ErrorText({ id, message }: { id: string; message?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const control = message && ref.current ? findInvalidControl(ref.current) : null;
    if (!control) return;
    const ids = (control.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
    if (!ids.includes(id)) control.setAttribute("aria-describedby", [...ids, id].join(" "));
    return () => {
      const rest = (control.getAttribute("aria-describedby") ?? "").split(" ").filter((x) => x && x !== id);
      if (rest.length) control.setAttribute("aria-describedby", rest.join(" "));
      else control.removeAttribute("aria-describedby");
    };
  }, [id, message]);
  if (!message) return null;
  return (
    <p ref={ref} id={id} className="mt-1.5 text-sm text-destructive">
      {message}
    </p>
  );
}

/**
 * Put as the FIRST child of a <form>. Whenever the form's state object changes (a submission came
 * back) it moves keyboard focus to the first invalid field, so errors are not silent for keyboard and
 * screen-reader users. With no invalid field (first render, success) it does nothing.
 */
export function FocusFirstError({ trigger }: { trigger: unknown }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.closest("form")?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [trigger]);
  return <span ref={ref} hidden />;
}

export function SubmitButton({ pending, children, pendingLabel }: { pending: boolean; children: React.ReactNode; pendingLabel: string }) {
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending} aria-disabled={pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}

interface PasswordInputProps extends Omit<React.ComponentProps<"input">, "type"> {
  invalid?: boolean;
}

/** Password field with a show/hide toggle. The value is never echoed back by the server. */
export function PasswordInput({ invalid, ...props }: PasswordInputProps) {
  const t = useTranslations("auth");
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} aria-invalid={invalid || undefined} className="pr-11" />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t("hidePassword") : t("showPassword")}
        aria-pressed={visible}
        className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground"
      >
        {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
      </button>
    </div>
  );
}
