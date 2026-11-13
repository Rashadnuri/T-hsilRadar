import { cn } from "@/lib/utils";

interface SectionHeadingProps {
  title: string;
  description?: string;
  eyebrow?: string;
  /** Right-aligned slot (e.g. a "view all" link); wraps below on narrow screens. */
  action?: React.ReactNode;
  id?: string;
  as?: "h1" | "h2";
  align?: "start" | "center";
  className?: string;
}

export function SectionHeading({ title, description, eyebrow, action, id, as: Tag = "h2", align = "start", className }: SectionHeadingProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        align === "center" && "items-center text-center sm:flex-col sm:items-center",
        className,
      )}
    >
      <div className={cn("min-w-0 max-w-2xl", align === "center" && "mx-auto")}>
        {eyebrow && <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent">{eyebrow}</p>}
        <Tag id={id} className="text-2xl font-bold sm:text-3xl">
          {title}
        </Tag>
        {description && <p className="mt-2 text-base text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
