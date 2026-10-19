import type { MasterProfile } from "@/lib/types";
import { nextSkillId, type SkillSection } from "./skills";

/** Pasting a list is far quicker than adding items one at a time: these turn pasted text into skills and experience facts. */

const MARK = /^\s*(?:[•●▪■◦·*–—-]|\d{1,3}[.)])\s*/;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Split on commas that are not inside brackets, so "Search Engine Optimization (SEO, GEO)" stays whole. */
export function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === ";") && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out.map(clean).filter(Boolean);
}

export type ParsedSkill = { name: string; group?: string };

const HEADING = /^([^:]{2,70}):\s*(\S.*)?$/;

/** Does the text look like "Heading: item, item" lines (as under TECHNICAL SKILLS) rather than one skill per line? */
export function looksGrouped(text: string): boolean {
  const lines = text.split("\n").map((l) => l.replace(MARK, "")).filter((l) => l.trim());
  return lines.length > 0 && lines.filter((l) => HEADING.test(l.trim()) && (HEADING.exec(l.trim())?.[2] ?? "").length > 0).length * 2 >= lines.length;
}

/**
 * One skill per line ("1. Generative AI"), or, when `grouped`, "Heading: item, item, item" lines where a line that wraps onto the next
 * one (no heading, no bullet) belongs to the line above it. Numbers and bullet marks are dropped.
 */
export function parseSkillLines(text: string, grouped = looksGrouped(text)): ParsedSkill[] {
  const rows = text.split("\n").map((l) => l.replace(/\r/g, ""));
  if (!grouped) return rows.map((l) => clean(l.replace(MARK, ""))).filter(Boolean).map((name) => ({ name }));
  const joined: string[] = [];
  for (const raw of rows) {
    if (!raw.trim()) continue;
    const bulleted = MARK.test(raw);
    const line = clean(raw.replace(MARK, ""));
    if (!bulleted && !HEADING.test(line) && joined.length) joined[joined.length - 1] += ` ${line}`;
    else joined.push(line);
  }
  const out: ParsedSkill[] = [];
  for (const line of joined) {
    const m = HEADING.exec(line);
    if (m && m[2]) for (const name of splitTop(m[2])) out.push({ name, group: clean(m[1]) });
    else for (const name of splitTop(line)) out.push({ name });
  }
  return out;
}

export type AddSkillsResult = { skills: MasterProfile["skills"]; added: string[]; skipped: string[] };

/** Add parsed skills, skipping any already there (any capitals) and repeats inside the paste. `first` puts them ahead of the existing ones, in the order pasted. */
export function addSkills(existing: MasterProfile["skills"], parsed: ParsedSkill[], o: { section: SkillSection; group?: string; extra?: boolean; first?: boolean }): AddSkillsResult {
  const seen = new Set(existing.map((s) => s.name.toLowerCase()));
  const made: MasterProfile["skills"] = [];
  const added: string[] = [], skipped: string[] = [];
  const all = [...existing];
  for (const p of parsed) {
    const key = p.name.toLowerCase();
    if (seen.has(key)) { skipped.push(p.name); continue; }
    seen.add(key);
    const group = p.group ?? (o.group?.trim() || undefined);
    const skill = { id: nextSkillId(all), name: p.name, ...(group ? { group } : {}), ...(o.section !== "other" ? { kind: o.section } : {}), ...(o.extra ? { extra: true } : {}) };
    all.push(skill);
    made.push(skill);
    added.push(p.name);
  }
  return { skills: o.first ? [...made, ...existing] : [...existing, ...made], added, skipped };
}

/**
 * Facts from pasted text: each bullet (•, -, *, a number) is one fact; text that wraps onto the next line joins the fact above; a paragraph
 * before the first bullet (a one-line description of the role) is a fact of its own.
 */
export function parseFacts(text: string): string[] {
  const facts: string[] = [];
  let open = false;
  for (const raw of text.split("\n")) {
    if (!raw.trim()) { open = false; continue; }
    const bulleted = MARK.test(raw);
    const line = clean(raw.replace(MARK, ""));
    if (!line) continue;
    if (bulleted || !open) { facts.push(line); open = true; }
    else facts[facts.length - 1] += ` ${line}`;
  }
  return facts;
}

export const allIds = (p: Pick<MasterProfile, "experience" | "education" | "skills" | "certifications" | "highlights" | "caseStudies" | "development" | "awards">): Set<string> =>
  new Set([
    ...p.experience.flatMap((e) => [e.id, ...e.bullets.map((b) => b.id)]),
    ...p.education.map((e) => e.id), ...p.skills.map((s) => s.id), ...p.certifications.map((c) => c.id),
    ...p.highlights.map((h) => h.id), ...p.caseStudies.map((c) => c.id), ...p.development.map((d) => d.id), ...p.awards.map((a) => a.id),
  ]);

/** Add facts to one role. `first` puts them at the top, in the order pasted. Facts already in the role (any capitals) are skipped. */
export function addFacts(profile: MasterProfile, experienceId: string, facts: string[], first = false): { experience: MasterProfile["experience"]; added: number; skipped: number } {
  const used = allIds(profile);
  let added = 0, skipped = 0;
  const experience = profile.experience.map((e) => {
    if (e.id !== experienceId) return e;
    const have = new Set(e.bullets.map((b) => clean(b.text).toLowerCase()));
    const made: MasterProfile["experience"][number]["bullets"] = [];
    let n = e.bullets.length;
    for (const f of facts) {
      if (have.has(f.toLowerCase())) { skipped++; continue; }
      have.add(f.toLowerCase());
      let id = `${e.id}-f${++n}`;
      while (used.has(id)) id = `${e.id}-f${++n}`;
      used.add(id);
      made.push({ id, text: f });
      added++;
    }
    return { ...e, bullets: first ? [...made, ...e.bullets] : [...e.bullets, ...made] };
  });
  return { experience, added, skipped };
}
