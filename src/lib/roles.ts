/**
 * Who may see and do what.
 *  - admin  (super admin): the owner and anyone in ALLOWED_EMAILS. Everything.
 *  - jobs   (Jobs & Apply): only "Jobs found & scored" and "Applications", and the actions on those two sections.
 *  - viewer (View only): the same two sections, read only.
 * Free of "server-only" so proxy.ts can use it.
 */
export type Role = "admin" | "jobs" | "viewer";
export const TEAM_ROLES = ["jobs", "viewer"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];
/** `profiles`: the profiles this person may open (a family member: only their own). Empty or missing = the default profile only. */
export type TeamMember = { email: string; role: TeamRole; profiles?: string[] };

export const ROLE_LABEL: Record<Role, string> = { admin: "Super admin", jobs: "Jobs & Apply", viewer: "View only" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isRole = (v: unknown): v is Role => v === "admin" || v === "jobs" || v === "viewer";

const PAGES = [/^\/jobs(\/|$)/, /^\/applications(\/|$)/];
const APIS = [
  /^\/api\/jobs(\/|$)/, /^\/api\/applications(\/|$)/, /^\/api\/bulk$/, /^\/api\/assistant\/run$/, /^\/api\/files$/,
  /^\/api\/answers\/learn$/, /^\/api\/autofill$/, /^\/api\/export\/applications$/,
];

/** May this role make this request? Anything not listed is refused for the non-admin roles. */
export function roleAllows(role: Role, pathname: string, method: string): boolean {
  if (role === "admin") return true;
  if (pathname === "/api/profiles/switch" && method === "POST") return true; // choosing which profile to look at changes nothing but a cookie
  const api = pathname.startsWith("/api/");
  if (!(api ? APIS : PAGES).some((re) => re.test(pathname))) return false;
  return role === "jobs" || method === "GET" || method === "HEAD";
}

export const homeFor = (role: Role): string => (role === "admin" ? "/" : "/jobs");

/** The sidebar groups a role sees (by link): null means everything. */
export const navHrefsFor = (role: Role): string[] | null => (role === "admin" ? null : ["/jobs", "/applications"]);

/** Normalise the stored team list: valid, lower-case, no duplicates. */
export function cleanTeam(raw: unknown): TeamMember[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: TeamMember[] = [];
  for (const m of raw) {
    const email = typeof m?.email === "string" ? m.email.trim().toLowerCase() : "";
    const role = (TEAM_ROLES as readonly string[]).includes(m?.role) ? (m.role as TeamRole) : null;
    const profiles = Array.isArray(m?.profiles) ? [...new Set((m.profiles as unknown[]).filter((x): x is string => typeof x === "string" && UUID.test(x)))] : [];
    if (email && role && !seen.has(email)) { seen.add(email); out.push(profiles.length ? { email, role, profiles } : { email, role }); }
  }
  return out;
}
