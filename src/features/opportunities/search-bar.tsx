import { Search } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { CleanGetForm } from "@/components/forms/clean-get-form";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SearchBarProps {
  defaultValue?: string;
  size?: "default" | "large";
  /** Wrap in its own form (homepage). Inside the catalogue form it is rendered as bare fields. */
  standalone?: boolean;
  className?: string;
}

export async function SearchBar({ defaultValue = "", size = "default", standalone = false, className }: SearchBarProps) {
  const t = await getTranslations("search");
  const large = size === "large";

  const fields = (
    <div
      role="search"
      className={cn(
        "flex items-center gap-2 rounded-2xl border bg-background p-1.5 shadow-card focus-within:border-accent focus-within:ring-2 focus-within:ring-ring/30",
        className,
      )}
    >
      <label htmlFor="opportunity-search" className="sr-only">
        {t("label")}
      </label>
      <Search className={cn("ml-2.5 shrink-0 text-muted-foreground", large ? "size-5" : "size-4")} aria-hidden="true" />
      <input
        id="opportunity-search"
        name="q"
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        maxLength={100}
        defaultValue={defaultValue}
        placeholder={t("placeholder")}
        className={cn(
          "min-w-0 flex-1 bg-transparent px-1 outline-none placeholder:text-muted-foreground/80",
          large ? "h-12 text-base" : "h-10 text-base sm:text-sm",
        )}
      />
      <Button type="submit" size={large ? "lg" : "default"} variant="accent" className="shrink-0">
        {t("button")}
      </Button>
    </div>
  );

  return standalone ? <CleanGetForm>{fields}</CleanGetForm> : fields;
}
