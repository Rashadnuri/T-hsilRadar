import { cn } from "@/lib/utils";

export const fieldClasses =
  "h-11 w-full rounded-lg border border-input bg-background px-3.5 text-base text-foreground shadow-soft transition-colors placeholder:text-muted-foreground/80 hover:border-slate-400 focus-visible:border-accent focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm";

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return <input type={type} className={cn(fieldClasses, className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(fieldClasses, "h-auto min-h-32 py-2.5", className)} {...props} />;
}
