import { AUTO_APPLY_ATS, parseAtsUrl, type Ats } from "../src/lib/jobs/ats";

export type CanaryProbe = { ats: Ats; url: string; opened: "already" | "clicked" | "none" | "error"; fields: number; error?: string };
export type CanaryVerdict = { ats: Ats; probes: number; working: number; broken: boolean };

/** Up to `perAts` recent job links for each automatic apply system, one per company board, so the probe spreads out. */
export function pickProbes(urls: string[], perAts = 2): { ats: Ats; url: string }[] {
  const seen = new Set<string>();
  const count: Partial<Record<Ats, number>> = {};
  const out: { ats: Ats; url: string }[] = [];
  for (const url of urls) {
    const p = parseAtsUrl(url);
    if (!p || !AUTO_APPLY_ATS.includes(p.ats)) continue;
    const key = `${p.ats}:${p.board}`.toLowerCase();
    if (seen.has(key) || (count[p.ats] ?? 0) >= perAts) continue;
    seen.add(key); count[p.ats] = (count[p.ats] ?? 0) + 1;
    out.push({ ats: p.ats, url });
  }
  return out;
}

/** A system counts as broken only when it was probed and none of its forms could be opened and filled: one bad posting is not an outage. */
export function judge(probes: CanaryProbe[]): CanaryVerdict[] {
  const by = new Map<Ats, CanaryProbe[]>();
  for (const p of probes) by.set(p.ats, [...(by.get(p.ats) ?? []), p]);
  return [...by].map(([ats, list]) => {
    const working = list.filter((p) => p.opened !== "error" && p.fields > 0).length;
    return { ats, probes: list.length, working, broken: working === 0 };
  });
}

export function report(verdicts: CanaryVerdict[]): string {
  if (!verdicts.length) return "Weekly check of the automatic apply forms: no recent postings to test.";
  const bad = verdicts.filter((v) => v.broken);
  const line = (v: CanaryVerdict) => `${v.ats}: ${v.working}/${v.probes} forms opened and filled`;
  return bad.length
    ? `Career Agent weekly check found a problem. ${bad.map(line).join("; ")}. The portal may have changed its form; automatic applying there will hand applications back to you until this is fixed.`
    : `Weekly check of the automatic apply forms passed (${verdicts.map(line).join("; ")}).`;
}
