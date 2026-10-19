import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Which profile the code running right now is working for.
 *  - In the app, the access check in proxy.ts decides it (the profile you picked in the header) and passes it as a header.
 *  - In the automation, a loop runs each step inside `withProfile`, so one profile's work can never touch another's.
 *  - A local script can name one with CAREER_PROFILE_ID.
 * With none of these, per-person data is refused instead of guessed.
 */
const store = new AsyncLocalStorage<{ id: string }>();

export const PROFILE_HEADER = "x-career-profile";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class NoProfileError extends Error {
  constructor() {
    super("No profile is selected for this request. Pick one in the header, or run the step inside withProfile().");
    this.name = "NoProfileError";
  }
}

export function withProfile<T>(id: string, fn: () => Promise<T>): Promise<T> {
  if (!UUID.test(id)) throw new Error(`"${id}" is not a profile id`);
  return store.run({ id }, fn);
}

export const profileInContext = (): string | null => store.getStore()?.id ?? null;

export async function currentProfileId(): Promise<string> {
  const c = store.getStore();
  if (c) return c.id;
  try {
    const { headers } = await import("next/headers");
    const v = (await headers()).get(PROFILE_HEADER);
    if (v && UUID.test(v)) return v;
  } catch { /* not inside a request */ }
  const env = process.env.CAREER_PROFILE_ID?.trim();
  if (env && UUID.test(env)) return env;
  throw new NoProfileError();
}
