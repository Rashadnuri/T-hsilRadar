import { Info, ShieldCheck, Bookmark, Sparkles } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Container } from "@/components/layout/container";

interface AuthShellProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  /** Link row under the form (e.g. "No account? Register"). */
  footer?: React.ReactNode;
  /** Optional notice (e.g. "authentication is not configured in this environment"). */
  notice?: string;
}

const benefits = [
  { key: "save", icon: Bookmark },
  { key: "match", icon: Sparkles },
  { key: "privacy", icon: ShieldCheck },
] as const;

/**
 * Shared layout for login / register / password reset: brand panel (desktop) + form card.
 * Layout only; the forms and the server actions live next to it.
 */
export async function AuthShell({ title, subtitle, children, footer, notice }: AuthShellProps) {
  const t = await getTranslations("auth");
  return (
    <div className="bg-gradient-to-b from-secondary to-background">
      <Container className="grid gap-8 py-10 sm:py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-stretch lg:gap-12 lg:py-20">
        <aside className="relative hidden overflow-hidden rounded-3xl bg-primary p-10 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
          <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-20 size-80 rounded-full bg-accent/30 blur-3xl" />
          <div className="relative">
            <h2 className="text-3xl font-bold !text-primary-foreground">{t("shell.title")}</h2>
            <p className="mt-3 text-primary-foreground/80">{t("shell.text")}</p>
          </div>
          <ul className="relative mt-10 space-y-5">
            {benefits.map(({ key, icon: Icon }) => (
              <li key={key} className="flex gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/10">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-semibold">{t(`shell.benefits.${key}.title`)}</p>
                  <p className="text-sm text-primary-foreground/75">{t(`shell.benefits.${key}.text`)}</p>
                </div>
              </li>
            ))}
          </ul>
        </aside>

        <div className="mx-auto w-full max-w-md lg:max-w-none">
          <div className="rounded-3xl border bg-card p-6 shadow-card sm:p-8">
            <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
            <p className="mt-2 text-muted-foreground">{subtitle}</p>
            {notice && (
              <p role="note" className="mt-5 flex items-start gap-2.5 rounded-xl border border-accent/25 bg-secondary px-3.5 py-3 text-sm text-primary">
                <Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
                {notice}
              </p>
            )}
            <div className="mt-6">{children}</div>
          </div>
          {footer && <p className="mt-6 text-center text-sm text-muted-foreground">{footer}</p>}
        </div>
      </Container>
    </div>
  );
}
