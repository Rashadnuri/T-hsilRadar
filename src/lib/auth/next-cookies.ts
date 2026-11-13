import { cookies } from "next/headers";
import type { CookieJar } from "./types";

/** The request's cookie store as a CookieJar. Writing works in Server Actions and Route Handlers only. */
export async function getNextCookieJar(): Promise<CookieJar> {
  const store = await cookies();
  return {
    getAll: () => store.getAll().map(({ name, value }) => ({ name, value })),
    setAll: (list) => {
      for (const { name, value, options } of list) store.set(name, value, options);
    },
  };
}
