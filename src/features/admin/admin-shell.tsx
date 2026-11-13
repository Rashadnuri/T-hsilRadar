import { ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Container } from "@/components/layout/container";
import { AdminNav } from "./admin-nav";

/** Frame of every admin page. Rendered by the PAGES (after the admin check), never by a layout: a layout would also frame the 404 a non-admin sees. */
export async function AdminShell({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const t = await getTranslations("admin");
  return (
    <Container className="py-8 sm:py-10">
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs font-semibold text-accent">
        <ShieldCheck className="size-4" aria-hidden="true" />
        {t("badge")}
      </div>
      <AdminNav />
      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold">{title}</h1>
          {subtitle && <p className="mt-2 max-w-2xl text-muted-foreground">{subtitle}</p>}
        </div>
        {actions}
      </div>
      <div className="mt-8">{children}</div>
    </Container>
  );
}
