import type { MasterProfile } from "@/lib/types";
import { estimateYears } from "./answers";

/**
 * "How many years of work experience do you have with Microsoft Azure?" asks about one tool. This reads which tool a question is about
 * (so one saved answer serves every wording of it) and, when the profile itself shows work with that tool, how long it was used.
 * Pure: no browser, no network.
 */

const ALIASES: Record<string, string> = { "amazon web services": "aws", "google cloud platform": "gcp", "google cloud": "gcp", "ms excel": "excel", "ms office": "office", "ms project": "project", "node js": "node", nodejs: "node", "react js": "react", reactjs: "react", "power bi": "powerbi", "sql server": "sqlserver" };
const FILLER = /^(the|a|an|using|use of|of|with|in|on|at)\s+/;

/** The tool, language or field a "years of experience" question is about, in a form two phrasings share; null when it is not such a question. */
export function yearsSkill(label: string): string | null {
  const l = label.replace(/[*✱?]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (!/\byears?\b/.test(l) && !/\bexperience\b/.test(l)) return null;
  const m =
    l.match(/(?:years?|yrs?)\b.{0,40}?\b(?:experience|exp|expertise|work(?:ed|ing)?|hands[- ]on)\b.{0,30}?\b(?:with|in|using|on|of|as)\s+(.{2,60})$/) ??
    l.match(/\bexperience\b.{0,30}?\b(?:with|in|using|on)\s+(.{2,60}?)\s*\(?(?:in )?(?:number of )?years?\)?$/) ??
    l.match(/^(.{2,60}?)\s+(?:experience|expertise)\s*\(?(?:in )?years?\)?$/) ??
    l.match(/(?:years?|yrs?)\s+(?:with|in|using|of)\s+(.{2,60})$/);
  if (!m) return null;
  let s = m[1].replace(/\b(do|did|have|you|your|please|required|total|professional|relevant|overall)\b/g, " ").replace(/[^a-z0-9+#. ]/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(FILLER, "").replace(/^microsoft\s+/, "").replace(/\s+(experience|skills?|platform|technology|tools?)$/, "").trim();
  s = ALIASES[s] ?? s;
  return s.length >= 2 && s.length <= 50 ? s : null;
}

const yearOf = (s: string | undefined, nowYear: number): number | null => {
  if (!s) return null;
  if (/present|current|now|till date/i.test(s)) return nowYear;
  const y = s.match(/\b(19|20)\d{2}\b/)?.[0];
  return y ? +y : null;
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (text: string, skill: string) => new RegExp(`(^|[^a-z0-9])${esc(skill).replace(/ /g, "[ -]?")}($|[^a-z0-9])`, "i").test(text);

/**
 * Whole years the profile shows work with this skill: from the first start to the last end of the roles that mention it by name (title or bullet).
 * A skill that is only in the skills list, or not there at all, is not a number of years the profile can vouch for, so the answer is null and the question goes to you.
 */
export function skillYears(p: MasterProfile, skill: string, nowYear = new Date().getFullYear()): string | null {
  const alias = Object.entries(ALIASES).filter(([, v]) => v === skill).map(([k]) => k);
  const names = [skill, ...alias];
  let min = Infinity, max = -Infinity;
  for (const e of p.experience) {
    const text = [e.title, ...e.bullets.map((b) => b.text)].join(" \n ");
    if (!names.some((n) => mentions(text, n))) continue;
    const start = yearOf(e.start, nowYear), end = yearOf(e.end, nowYear);
    if (start !== null) min = Math.min(min, start);
    if (end !== null) max = Math.max(max, end);
    else if (start !== null) max = Math.max(max, start);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return String(Math.max(1, max - min));
}

/** A count asked for in a text box ("3 years" becomes "3"): forms that want a number reject words. */
export function asCount(value: string): string {
  const m = value.match(/\d+(?:\.\d+)?/);
  return m ? m[0] : value;
}

/** Is this a question whose answer is a number? */
export const wantsNumber = (label: string): boolean => yearsSkill(label) !== null || /^\s*(how many|number of|total (years|number))\b/i.test(label.replace(/^[^a-z]+/i, ""));

/** Tools and fields of AI: a newer field, so a short history is the believable one. */
const AI_TOOL = /\b(ai|a\.i\.|genai|gen ai|generative ai|artificial intelligence|llms?|large language models?|gpt|chatgpt|openai|copilot|claude|gemini|anthropic|langchain|rag|prompt engineering|machine learning|ml|nlp|agentic|ai agents?|mcp|vector databases?|hugging ?face|diffusion|computer vision|deep learning|neural networks?)\b/i;
export const AI_TOOL_YEARS = 3;
export const GENERIC_TOOL_YEARS = 12;

/**
 * The owner's standing rule for a "years with X" question the profile cannot back: a general tool or field gets 10 to 15 years (12, and never more
 * than the career itself), a tool of AI gets 3. It is only a default: a saved answer for that tool, and years the profile itself shows, both come first.
 */
export function defaultToolYears(p: MasterProfile, skill: string, nowYear = new Date().getFullYear()): string {
  if (AI_TOOL.test(skill)) return String(AI_TOOL_YEARS);
  const career = estimateYears(p.experience, nowYear);
  return String(career === null ? 10 : Math.max(1, Math.min(GENERIC_TOOL_YEARS, career)));
}
