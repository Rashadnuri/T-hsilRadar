import { cn } from "@/lib/utils";

/** Page-width wrapper with the 16px mobile gutter required by the design brief. */
export function Container({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8", className)} {...props} />;
}
