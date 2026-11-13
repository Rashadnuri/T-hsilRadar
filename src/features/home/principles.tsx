import { BadgeCheck, Languages, Link2, Sparkles, type LucideIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

const principles: { key: "source" | "verified" | "languages" | "ai"; icon: LucideIcon }[] = [
  { key: "source", icon: Link2 },
  { key: "verified", icon: BadgeCheck },
  { key: "languages", icon: Languages },
  { key: "ai", icon: Sparkles },
];

/** Trust principles from PRODUCT_SPEC §3. Reused on the home and About pages. */
export async function PrincipleList() {
  const t = await getTranslations("principles");
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {principles.map(({ key, icon: Icon }) => (
        <li key={key} className="flex gap-4 rounded-xl border bg-card p-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-accent">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h3 className="font-semibold">{t(`${key}.title`)}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t(`${key}.text`)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
