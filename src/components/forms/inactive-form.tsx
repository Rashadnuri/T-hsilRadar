"use client";

/**
 * Form shell for screens whose backend does not exist yet (auth, contact). It renders the real
 * layout and fields but never submits, so nothing is sent or stored. The submit button is
 * rendered disabled by the caller, and a visible notice explains why.
 */
export function InactiveForm({ children, ...props }: Omit<React.ComponentProps<"form">, "onSubmit" | "action">) {
  return (
    <form noValidate onSubmit={(event) => event.preventDefault()} {...props}>
      {children}
    </form>
  );
}
