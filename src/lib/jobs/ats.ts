/** Applicant-tracking systems whose public job boards can be read directly, and whose application forms the worker can fill. */
export type Ats = "greenhouse" | "lever" | "ashby" | "workable" | "recruitee";

export const ATS_LABEL: Record<Ats, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workable: "Workable", recruitee: "Recruitee" };

/** ATS whose forms the worker submits automatically (within the safety rules); the rest are prepared for you. */
export const AUTO_APPLY_ATS: Ats[] = ["greenhouse", "lever", "ashby", "workable"];

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,60}$/;

/** Which ATS a posting URL belongs to, and the board (company token) it is on. Pure. */
export function parseAtsUrl(url: string): { ats: Ats; board: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  const first = u.pathname.split("/").filter(Boolean)[0];
  const ok = (b: string | undefined) => (b && SEGMENT.test(b) && !["embed", "jobs", "j", "o", "api", "v1"].includes(b.toLowerCase()) ? b : null);
  if (/(^|\.)greenhouse\.io$/.test(host)) { const b = ok(first); return b ? { ats: "greenhouse", board: b } : null; }
  if (/(^|\.)lever\.co$/.test(host) && /^jobs\./.test(host)) { const b = ok(first); return b ? { ats: "lever", board: b } : null; }
  if (host === "jobs.ashbyhq.com") { const b = ok(first); return b ? { ats: "ashby", board: b } : null; }
  if (host === "apply.workable.com") { const b = ok(first); return b ? { ats: "workable", board: b } : null; }
  const rec = host.match(/^([a-z0-9-]+)\.recruitee\.com$/);
  if (rec && rec[1] !== "www" && rec[1] !== "api" && /^\/o\//.test(u.pathname)) return { ats: "recruitee", board: rec[1] };
  return null;
}

export type Watchlist = { boards: Record<Ats, string[]>; added: Record<string, string> };
export const EMPTY_WATCHLIST: Watchlist = { boards: { greenhouse: [], lever: [], ashby: [], workable: [], recruitee: [] }, added: {} };

/**
 * Companies seen posting a matching job become part of the watchlist, so their other openings are read directly from their own
 * board in later scans (free, complete descriptions, and the form can be applied for automatically). Boards you listed yourself are
 * not repeated, and the list is capped per ATS so it cannot grow without bound. Returns the new list and the boards that were added.
 */
export function mergeWatchlist(current: Watchlist, urls: string[], listed: Partial<Record<Ats, string[]>>, capPerAts = 150, now = new Date()): { watchlist: Watchlist; added: { ats: Ats; board: string }[] } {
  const next: Watchlist = { boards: { ...EMPTY_WATCHLIST.boards, ...Object.fromEntries(Object.entries(current.boards).map(([k, v]) => [k, [...v]])) } as Watchlist["boards"], added: { ...current.added } };
  const added: { ats: Ats; board: string }[] = [];
  const have = (ats: Ats, board: string) => next.boards[ats].some((b) => b.toLowerCase() === board.toLowerCase()) || (listed[ats] ?? []).some((b) => b.toLowerCase() === board.toLowerCase());
  for (const url of urls) {
    const p = parseAtsUrl(url);
    if (!p || have(p.ats, p.board) || next.boards[p.ats].length >= capPerAts) continue;
    next.boards[p.ats].push(p.board);
    next.added[`${p.ats}:${p.board}`] = now.toISOString();
    added.push(p);
  }
  return { watchlist: next, added };
}
