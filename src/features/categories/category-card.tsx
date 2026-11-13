import { ArrowUpRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { OpportunityType } from "@/types/opportunity";
import { opportunityTypeIcons } from "@/features/opportunities/type-icons";
import { Link } from "@/i18n/navigation";

export async function CategoryCard({ code }: { code: OpportunityType }) {
  const t = await getTranslations("opportunityTypes");
  const Icon = opportunityTypeIcons[code];
  return (
    <Link
      href={{ pathname: "/opportunities", query: { type: code } }}
      className="group flex min-h-20 items-center gap-3.5 rounded-2xl border bg-card p-4 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-card-hover motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-secondary text-accent transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 font-semibold leading-snug text-primary">{t(code)}</span>
      <ArrowUpRight
        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none"
        aria-hidden="true"
      />
    </Link>
  );
}
