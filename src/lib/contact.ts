type Env = Record<string, string | undefined>;

const PLACEHOLDER = /^your-|^changeme|^<.*>$|(^|\.)example\.(com|org|net)$|\.test$|\.invalid$/i;
// One "@", no spaces or characters that could break a mailto link or a header; a real-looking domain with a dot.
const SHAPE = /^[^\s@<>"',;:()[\]\\]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * The public contact address, supplied by the operator in NEXT_PUBLIC_CONTACT_EMAIL (it is shown on a public
 * page, so it is public by nature). Returns null when unset, malformed or a placeholder: the Contact page then
 * keeps its honest "not active yet" notice instead of showing a dead address.
 */
export function getContactEmail(env: Env = process.env): string | null {
  const value = env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();
  if (!value || value.length > 254 || !SHAPE.test(value)) return null;
  return PLACEHOLDER.test(value.split("@")[1]!) || PLACEHOLDER.test(value) ? null : value;
}

/** mailto: link with a prefilled subject (the subject comes from our own translations, never from user input). */
export const mailtoHref = (email: string, subject: string) => `mailto:${email}?subject=${encodeURIComponent(subject)}`;
