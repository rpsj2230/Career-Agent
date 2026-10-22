import { parseAtsUrl, type Ats } from "./ats";
import { isRedirector } from "./redirectors";
import { mapAshby, mapGreenhouse, mapLever, mapRecruitee, mapWorkable } from "./map";

/**
 * Other ways to reach an application form for a job that came from a job board whose own Apply link does not lead anywhere usable:
 *  1. the job's own description often names the employer's application page, so any link in it that is an applicant-tracking system is tried;
 *  2. the employer very often posts the same job on its own board (Greenhouse, Lever, Ashby, Workable, Recruitee), whose public job list can be
 *     read by anyone, so the company's board is looked up and the job found there by its title.
 * Nothing here guesses loosely: a posting is only returned when its title matches and, where the board shows one, so does its place.
 * Pure apart from `getJson`, which the caller supplies (so tests never touch the network).
 */
export type Direct = { url: string; ats: Ats; how: string };
export type AltDeps = { getJson(url: string): Promise<unknown | null> };

const LEGAL = new Set(["pty", "ltd", "limited", "inc", "incorporated", "llc", "llp", "plc", "corp", "corporation", "co", "company", "gmbh", "ag", "sa", "pte", "private", "pvt", "bv", "nv", "the", "and"]);
const FILLER = new Set(["group", "holdings", "holding", "international", "global", "services", "solutions", "consulting", "recruitment", "careers", "operations", "australia", "india", "singapore", "canada", "uk", "usa", "technologies", "technology", "systems"]);

/** Likely board names for a company: "Natural Selection Group Pty Ltd" gives naturalselection, natural-selection, naturalselectiongroup ... */
export function slugCandidates(company: string): string[] {
  const words = company.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((w) => w && !LEGAL.has(w));
  if (words.length === 0) return [];
  const core = words.filter((w) => !FILLER.has(w));
  const sets = [core.length ? core : words, words];
  const out: string[] = [];
  for (const w of sets) {
    out.push(w.join(""), w.join("-"));
    if (w.length > 2) out.push(w.slice(0, 2).join(""), w.slice(0, 2).join("-"));
    if (w.length > 1 && w[0].length >= 4) out.push(w[0]);
  }
  return [...new Set(out)].filter((s) => /^[a-z0-9][a-z0-9-]{2,40}$/.test(s)).slice(0, 8);
}

const STOP = new Set(["a", "an", "the", "of", "and", "for", "to", "in", "at", "with", "remote", "hybrid", "full", "time", "part", "permanent", "contract", "fixed", "term", "ftc"]);
const tokens = (title: string) => title.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[|–—@].*$/, " ").replace(/\s-\s.*$/, " ").replace(/[^a-z0-9+#]+/g, " ").split(/\s+/).filter((t) => t && !STOP.has(t));

/** 1 when the two titles are the same words in any order, lower as they differ. */
export function titleSimilarity(a: string, b: string): number {
  const x = new Set(tokens(a)), y = new Set(tokens(b));
  if (x.size === 0 || y.size === 0) return 0;
  let both = 0;
  for (const t of x) if (y.has(t)) both++;
  return both / (x.size + y.size - both);
}

const place = (s: string) => new Set(s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !["remote", "hybrid", "the", "and", "area", "region"].includes(w)));
/** Do two places share a word (a city or country)? Unknown on either side counts as not disagreeing. */
export function placesAgree(ours: string | null | undefined, theirs: string | null | undefined): boolean {
  if (!ours || !theirs) return true;
  const a = place(ours), b = place(theirs);
  if (a.size === 0 || b.size === 0) return true;
  for (const w of a) if (b.has(w)) return true;
  return false;
}

/** Links in a job description that point at an applicant-tracking system, in the order they appear. */
export function atsLinksIn(text: string | null | undefined): Direct[] {
  const out: Direct[] = [];
  for (const m of (text ?? "").matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) {
    const url = m[0].replace(/[.,;:]+$/, "");
    if (isRedirector(url)) continue;
    const ats = parseAtsUrl(url);
    if (ats) out.push({ url, ats: ats.ats, how: `the application link named in the job description (${ats.ats})` });
  }
  return [...new Map(out.map((d) => [d.url, d])).values()];
}

type Posting = { title: string; url: string; location?: string };
const BOARDS: { ats: Ats; url: (slug: string) => string; read: (data: any, slug: string) => Posting[] }[] = [ // eslint-disable-line @typescript-eslint/no-explicit-any
  { ats: "greenhouse", url: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`, read: (d, s) => (d?.jobs ?? []).map((r: unknown) => mapGreenhouse(r, s)) },
  { ats: "lever", url: (s) => `https://api.lever.co/v0/postings/${s}?mode=json`, read: (d, s) => (Array.isArray(d) ? d : []).map((r: unknown) => mapLever(r, s)) },
  { ats: "ashby", url: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`, read: (d, s) => (d?.jobs ?? []).map((r: unknown) => mapAshby(r, s)) },
  { ats: "workable", url: (s) => `https://apply.workable.com/api/v1/widget/accounts/${s}`, read: (d, s) => (d?.jobs ?? []).map((r: unknown) => mapWorkable(r, s)) },
  { ats: "recruitee", url: (s) => `https://${s}.recruitee.com/api/offers/`, read: (d, s) => (d?.offers ?? []).map((r: unknown) => mapRecruitee(r, s)) },
];

const MIN_TITLE = 0.85;

/**
 * Look for the same job on the employer's own boards. Returns the posting only when exactly one job there matches the title (and place):
 * two equally good matches are ambiguous and nothing is returned, because applying to the wrong role is worse than not applying.
 */
export async function findOnEmployerBoards(job: { title: string; company: string; location?: string | null }, deps: AltDeps): Promise<Direct | null> {
  return findOnBoards(job, slugCandidates(job.company).flatMap((slug) => BOARDS.map((b) => ({ ats: b.ats, slug }))), deps, "the employer's own");
}

/** The same lookup for boards already known by name (for example a board a careers page links to), so nothing is guessed. */
export async function findOnBoards(job: { title: string; company: string; location?: string | null }, boards: { ats: Ats; slug: string }[], deps: AltDeps, whose = "the employer's own"): Promise<Direct | null> {
  const unique = [...new Map(boards.map((b) => [`${b.ats}:${b.slug}`, b])).values()];
  const jobs = await Promise.all(unique.map(async ({ ats, slug }) => {
    const b = BOARDS.find((x) => x.ats === ats);
    if (!b) return null;
    const data = await deps.getJson(b.url(slug)).catch(() => null);
    return data ? { b, slug, postings: b.read(data, slug) as Posting[] } : null;
  }));
  const hits: { ats: Ats; slug: string; p: Posting; score: number }[] = [];
  for (const j of jobs) {
    if (!j) continue;
    for (const p of j.postings) {
      if (!p.url) continue;
      const score = titleSimilarity(job.title, p.title);
      if (score >= MIN_TITLE && placesAgree(job.location, p.location)) hits.push({ ats: j.b.ats, slug: j.slug, p, score });
    }
  }
  if (hits.length === 0) return null;
  const best = Math.max(...hits.map((h) => h.score));
  const top = hits.filter((h) => h.score === best);
  if (new Set(top.map((h) => h.p.url)).size !== 1) return null;
  const h = top[0];
  return { url: h.p.url, ats: h.ats, how: `the same job on ${whose} ${h.ats} board (${h.slug})` };
}

/** Every alternative, in order: links named in the description first (no guessing), then the employer's own boards. */
export async function alternativeRoutes(job: { title: string; company: string; location?: string | null; description?: string | null }, deps: AltDeps): Promise<Direct[]> {
  const named = atsLinksIn(job.description);
  const found = await findOnEmployerBoards(job, deps);
  return [...named, ...(found && !named.some((n) => n.url === found.url) ? [found] : [])];
}
