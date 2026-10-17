import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { detectApplyType, type ApplyType } from "./normalize";

/** Hosts whose links are tracking redirects to the real posting, not the posting itself. */
const REDIRECTORS = [/(^|\.)adzuna\.[a-z.]+$/i, /(^|\.)jooble\.org$/i, /(^|\.)careerjet\.[a-z.]+$/i, /(^|\.)jobrapido\.com$/i];

export const isRedirector = (url: string): boolean => {
  try { const h = new URL(url).hostname; return REDIRECTORS.some((r) => r.test(h)); } catch { return false; }
};

/** True for addresses that must never be fetched from a server: loopback, private, link-local (cloud metadata), unspecified. */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase();
  if (isIP(v) === 6) {
    if (v === "::1" || v === "::" || v.startsWith("fe80:") || /^f[cd]/.test(v)) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const p = v.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export type ResolveDeps = {
  lookup: (host: string) => Promise<string[]>;
  fetch: (url: string, init: { redirect: "manual"; signal: AbortSignal; headers: Record<string, string>; method: string }) => Promise<{ status: number; headers: { get(name: string): string | null }; body?: { cancel?: () => Promise<void> } | null }>;
};
const liveDeps: ResolveDeps = {
  lookup: async (host) => (await lookup(host, { all: true })).map((a) => a.address),
  fetch: (url, init) => fetch(url, init),
};

/**
 * Follow a link's redirects to the page it finally lands on, without downloading any page. Every hop is checked first:
 * only http(s), and never a host that is, or resolves to, a private or internal address. Returns null when it cannot be
 * resolved safely (the caller then keeps the original link).
 */
export async function resolveFinalUrl(start: string, deps: ResolveDeps = liveDeps, maxHops = 6, timeoutMs = 8000): Promise<string | null> {
  let url = start;
  for (let hop = 0; hop <= maxHops; hop++) {
    let u: URL;
    try { u = new URL(url); } catch { return null; }
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) return null;
    try {
      const addrs = isIP(host) ? [host] : await deps.lookup(host);
      if (!addrs.length || addrs.some(isPrivateAddress)) return null;
    } catch { return null; }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await deps.fetch(url, { method: "GET", redirect: "manual", signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; CareerAgent link check)", Accept: "text/html" } });
      await res.body?.cancel?.().catch(() => undefined);
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, url).href; continue; }
      return url;
    } catch { return null; } finally { clearTimeout(timer); }
  }
  return null;
}

/**
 * A job found through an aggregator often links to a tracker that leads to the employer's own application system. When that
 * system is one the worker can fill (Greenhouse, Lever), switch the job to the real page so it can be applied for
 * automatically; otherwise leave it alone.
 */
export async function upgradeApplyTarget(job: { url: string; apply_type: ApplyType }, deps?: ResolveDeps): Promise<{ url: string; apply_type: ApplyType } | null> {
  if (!isRedirector(job.url)) return null;
  const final = await resolveFinalUrl(job.url, deps);
  if (!final || final === job.url) return null;
  const type = detectApplyType(final);
  return type === "greenhouse" || type === "lever" ? { url: final, apply_type: type } : null;
}
