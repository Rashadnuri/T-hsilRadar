"use client";

import { useActionState } from "react";
import { MailCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { resetPlan } from "@/features/plan/plan-store";
import { forgotPasswordAction, loginAction, registerAction, resetPasswordAction } from "./actions";
import { ErrorText, FocusFirstError, FormAlert, PasswordInput, SubmitButton, useFieldErrorText } from "./form-parts";
import { initialFormState, type FormState } from "./state";

function Confirmation({ title, text }: { title: string; text: string }) {
  return (
    <div role="status" className="rounded-2xl border border-accent/25 bg-secondary p-5 text-primary">
      <MailCheck className="size-6 text-accent" aria-hidden="true" />
      <h2 className="mt-3 text-lg font-semibold">{title}</h2>
      <p className="mt-1.5 text-sm">{text}</p>
    </div>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const t = useTranslations("auth");
  const text = useFieldErrorText();
  const [state, action, pending] = useActionState(async (previous: FormState, form: FormData) => { resetPlan(); return loginAction(previous, form); }, initialFormState);
  const emailError = text(state.fieldErrors?.email);
  const passwordError = text(state.fieldErrors?.password);
  return (
    <form action={action} noValidate className="space-y-4">
      <FocusFirstError trigger={state} />
      {next && <input type="hidden" name="next" value={next} />}
      <FormAlert state={state} />
      <div>
        <Field label={t("email")}>
          {(p) => (
            <Input {...p} name="email" type="email" autoComplete="email" inputMode="email" placeholder={t("emailPlaceholder")} defaultValue={state.values?.email} aria-invalid={!!emailError} />
          )}
        </Field>
        <ErrorText id="login-email-err" message={emailError} />
      </div>
      <div>
        <Field label={t("password")}>
          {(p) => <PasswordInput {...p} name="password" autoComplete="current-password" invalid={!!passwordError} />}
        </Field>
        <ErrorText id="login-password-err" message={passwordError} />
      </div>
      <div className="text-right">
        <Link href="/forgot-password" className="inline-flex min-h-9 items-center text-sm font-medium text-accent hover:underline">
          {t("forgot")}
        </Link>
      </div>
      <SubmitButton pending={pending} pendingLabel={t("pending")}>
        {t("login.submit")}
      </SubmitButton>
    </form>
  );
}

export function RegisterForm() {
  const t = useTranslations("auth");
  const text = useFieldErrorText();
  const [state, action, pending] = useActionState(async (previous: FormState, form: FormData) => { resetPlan(); return registerAction(previous, form); }, initialFormState);
  if (state.status === "success" && state.message === "check_email") {
    return <Confirmation title={t("register.checkEmail.title")} text={t("register.checkEmail.text", { email: state.values?.email ?? "" })} />;
  }
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} noValidate className="space-y-4">
      <FocusFirstError trigger={state} />
      <FormAlert state={state} />
      <div>
        <Field label={t("name")}>{(p) => <Input {...p} name="fullName" autoComplete="name" defaultValue={state.values?.fullName} aria-invalid={!!errors.fullName} />}</Field>
        <ErrorText id="register-name-err" message={text(errors.fullName)} />
      </div>
      <div>
        <Field label={t("email")}>
          {(p) => <Input {...p} name="email" type="email" autoComplete="email" inputMode="email" placeholder={t("emailPlaceholder")} defaultValue={state.values?.email} aria-invalid={!!errors.email} />}
        </Field>
        <ErrorText id="register-email-err" message={text(errors.email)} />
      </div>
      <div>
        <Field label={t("password")} hint={t("register.passwordHint")}>
          {(p) => <PasswordInput {...p} name="password" autoComplete="new-password" invalid={!!errors.password} />}
        </Field>
        <ErrorText id="register-password-err" message={text(errors.password)} />
      </div>
      <div>
        <Field label={t("register.confirmPassword")}>
          {(p) => <PasswordInput {...p} name="confirmPassword" autoComplete="new-password" invalid={!!errors.confirmPassword} />}
        </Field>
        <ErrorText id="register-confirm-err" message={text(errors.confirmPassword)} />
      </div>
      <SubmitButton pending={pending} pendingLabel={t("pending")}>
        {t("register.submit")}
      </SubmitButton>
      <p className="text-xs text-muted-foreground">{t("register.consent")}</p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const text = useFieldErrorText();
  const [state, action, pending] = useActionState(forgotPasswordAction, initialFormState);
  if (state.status === "success" && state.message === "reset_sent") {
    return <Confirmation title={t("forgotPassword.sent.title")} text={t("forgotPassword.sent.text", { email: state.values?.email ?? "" })} />;
  }
  const emailError = text(state.fieldErrors?.email);
  return (
    <form action={action} noValidate className="space-y-4">
      <FocusFirstError trigger={state} />
      <FormAlert state={state} />
      <div>
        <Field label={t("email")}>
          {(p) => <Input {...p} name="email" type="email" autoComplete="email" inputMode="email" placeholder={t("emailPlaceholder")} defaultValue={state.values?.email} aria-invalid={!!emailError} />}
        </Field>
        <ErrorText id="forgot-email-err" message={emailError} />
      </div>
      <SubmitButton pending={pending} pendingLabel={t("pending")}>
        {t("forgotPassword.submit")}
      </SubmitButton>
    </form>
  );
}

export function ResetPasswordForm() {
  const t = useTranslations("auth");
  const text = useFieldErrorText();
  const [state, action, pending] = useActionState(async (previous: FormState, form: FormData) => { resetPlan(); return resetPasswordAction(previous, form); }, initialFormState);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} noValidate className="space-y-4">
      <FocusFirstError trigger={state} />
      <FormAlert state={state} />
      <div>
        <Field label={t("resetPassword.newPassword")} hint={t("register.passwordHint")}>
          {(p) => <PasswordInput {...p} name="password" autoComplete="new-password" invalid={!!errors.password} />}
        </Field>
        <ErrorText id="reset-password-err" message={text(errors.password)} />
      </div>
      <div>
        <Field label={t("register.confirmPassword")}>
          {(p) => <PasswordInput {...p} name="confirmPassword" autoComplete="new-password" invalid={!!errors.confirmPassword} />}
        </Field>
        <ErrorText id="reset-confirm-err" message={text(errors.confirmPassword)} />
      </div>
      <SubmitButton pending={pending} pendingLabel={t("pending")}>
        {t("resetPassword.submit")}
      </SubmitButton>
    </form>
  );
}
