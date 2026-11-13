/** Single source of truth for navigation. Labels: messages nav.<labelKey>. */
export const navItems = [
  { href: "/opportunities", labelKey: "opportunities" },
  { href: "/about", labelKey: "about" },
  { href: "/contact", labelKey: "contact" },
] as const;

export type NavItem = (typeof navItems)[number];
