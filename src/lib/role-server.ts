import "server-only";
import { headers } from "next/headers";
import { isRole, type Role } from "./roles";

/** The role of whoever is asking, as stated by the access check in proxy.ts. If it is missing, the least access applies. */
export async function currentRole(): Promise<Role> {
  const v = (await headers()).get("x-career-role");
  return isRole(v) ? v : "viewer";
}
