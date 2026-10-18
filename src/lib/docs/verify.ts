import type { CoverLetter, MasterProfile, TailoredResume } from "@/lib/types";

export type VerifyIssue = { where: string; problem: string };
export type VerifyResult = { ok: boolean; issues: VerifyIssue[]; mapping: Record<string, string[]> };

/** Map of every citable fact id to its text. */
export function factIndex(p: MasterProfile): Map<string, string> {
  const m = new Map<string, string>();
  m.set("summary", p.basics.summary);
  for (const e of p.experience) {
    m.set(e.id, `${e.title} ${e.company} ${e.start ?? ""} ${e.end ?? ""}`);
    for (const b of e.bullets) m.set(b.id, b.text);
  }
  for (const s of p.skills) m.set(s.id, s.name);
  for (const c of p.certifications) m.set(c.id, c.name);
  for (const ed of p.education) m.set(ed.id, `${ed.degree} ${ed.school}`);
  for (const h of p.highlights ?? []) m.set(h.id, h.text);
  return m;
}

const NUMBER_WORDS: Record<string, string> = {
  two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
  fifteen: "15", twenty: "20", thirty: "30", forty: "40", fifty: "50", sixty: "60", seventy: "70", eighty: "80", ninety: "90",
};

/**
 * Numbers in a text, normalised for comparison: thousands separators and a trailing "%" are ignored ("24%" = "24 percent"
 * = "24"), and spelled-out numbers count ("five" = "5"), so words cannot be used to slip in a figure.
 */
export function numbersIn(text: string): string[] {
  const digits = (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "").replace(/^0+(?=\d)/, ""));
  const words = (text.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w in NUMBER_WORDS).map((w) => NUMBER_WORDS[w]);
  return [...digits, ...words];
}

// ---------------------------------------------------------------- invented terms (tools, employers, titles ...)

// ---------------------------------------------------------------- abbreviations and equivalent wordings
//
// "PM" and "Product Manager", "VP" and "Vice President", "Sr." and "Senior" are the same fact written two ways, so a
// model using the other form is not inventing anything. Three sources of equivalence, none of which needs a model:
//  1. a table of common abbreviations (below), applied only when the profile already uses one side of the pair,
//  2. initialisms learned from the profile itself ("Net Promoter Score" => "NPS"), and
//  3. "Full Name (ABBR)" pairs the candidate wrote.

type Equiv = { abbr: string; full: string[]; /** words one of which must already be in the profile (disambiguates "PM") */ context?: string[] };
const EQUIVALENTS: Equiv[] = [
  { abbr: "pm", full: ["product manager", "product management"], context: ["product"] },
  { abbr: "pm", full: ["project manager", "project management"], context: ["project"] },
  { abbr: "pm", full: ["program manager", "program management"], context: ["program", "programme"] },
  { abbr: "pm", full: ["product manager"], context: ["saas", "fintech", "growth", "roadmap", "roadmapping", "backlog", "discovery", "activation"] },
  { abbr: "tpm", full: ["technical program manager", "technical programme manager"] },
  { abbr: "po", full: ["product owner"] }, { abbr: "sm", full: ["scrum master"] },
  { abbr: "swe", full: ["software engineer", "software engineering"] }, { abbr: "sde", full: ["software development engineer", "software engineer"] },
  { abbr: "qa", full: ["quality assurance"] }, { abbr: "ba", full: ["business analyst", "business analysis"] },
  { abbr: "ml", full: ["machine learning"] }, { abbr: "ai", full: ["artificial intelligence"] }, { abbr: "nlp", full: ["natural language processing"] },
  { abbr: "ux", full: ["user experience"] }, { abbr: "ui", full: ["user interface"] }, { abbr: "cx", full: ["customer experience"] },
  { abbr: "hr", full: ["human resources"] }, { abbr: "vp", full: ["vice president"] }, { abbr: "svp", full: ["senior vice president"] },
  { abbr: "ceo", full: ["chief executive officer"] }, { abbr: "cto", full: ["chief technology officer", "chief technical officer"] },
  { abbr: "cfo", full: ["chief financial officer"] }, { abbr: "coo", full: ["chief operating officer"] }, { abbr: "cmo", full: ["chief marketing officer"] },
  { abbr: "cpo", full: ["chief product officer"] },
  { abbr: "kpi", full: ["key performance indicator", "key performance indicators"] }, { abbr: "okr", full: ["objectives and key results"] },
  { abbr: "roi", full: ["return on investment"] }, { abbr: "p&l", full: ["profit and loss"] }, { abbr: "pnl", full: ["profit and loss"] },
  { abbr: "crm", full: ["customer relationship management"] }, { abbr: "erp", full: ["enterprise resource planning"] },
  { abbr: "mvp", full: ["minimum viable product"] }, { abbr: "gtm", full: ["go to market", "go-to-market"] },
  { abbr: "b2b", full: ["business to business", "business-to-business"] }, { abbr: "b2c", full: ["business to consumer", "business-to-consumer"] },
  { abbr: "saas", full: ["software as a service"] }, { abbr: "seo", full: ["search engine optimization", "search engine optimisation"] },
  { abbr: "sem", full: ["search engine marketing"] }, { abbr: "cac", full: ["customer acquisition cost"] }, { abbr: "ltv", full: ["lifetime value", "customer lifetime value"] },
  { abbr: "nps", full: ["net promoter score"] }, { abbr: "csat", full: ["customer satisfaction"] }, { abbr: "sla", full: ["service level agreement"] },
  { abbr: "sop", full: ["standard operating procedure", "standard operating procedures"] }, { abbr: "ci/cd", full: ["continuous integration", "continuous delivery"] },
  { abbr: "mba", full: ["master of business administration"] }, { abbr: "bsc", full: ["bachelor of science"] }, { abbr: "msc", full: ["master of science"] },
  { abbr: "btech", full: ["bachelor of technology"] }, { abbr: "mtech", full: ["master of technology"] }, { abbr: "be", full: ["bachelor of engineering"] },
  { abbr: "sr", full: ["senior"] }, { abbr: "jr", full: ["junior"] }, { abbr: "mgr", full: ["manager"] }, { abbr: "eng", full: ["engineer", "engineering"] },
  { abbr: "dev", full: ["developer", "development"] }, { abbr: "ops", full: ["operations"] }, { abbr: "exec", full: ["executive"] },
  { abbr: "dir", full: ["director"] }, { abbr: "asst", full: ["assistant"] }, { abbr: "assoc", full: ["associate"] }, { abbr: "yoy", full: ["year over year", "year-over-year"] },
  { abbr: "mom", full: ["month over month", "month-over-month"] }, { abbr: "qoq", full: ["quarter over quarter", "quarter-over-quarter"] },
  { abbr: "uk", full: ["united kingdom"] }, { abbr: "us", full: ["united states"] }, { abbr: "usa", full: ["united states"] }, { abbr: "uae", full: ["united arab emirates"] },
];

const wordList = (s: string) => (s.toLowerCase().match(/[a-z0-9&]+/g) ?? []);
const hasAll = (v: Set<string>, words: string[]) => words.length > 0 && words.every((w) => v.has(w));

/** Add the other spelling of every abbreviation the profile uses, and the abbreviation of every phrase it spells out. */
function addEquivalents(v: Set<string>, texts: string[]) {
  for (const e of EQUIVALENTS) {
    const abbrPresent = v.has(e.abbr) || e.abbr.split("/").every((x) => v.has(x));
    const contextOk = !e.context || e.context.some((c) => v.has(c));
    for (const full of e.full) {
      const words = wordList(full);
      if (hasAll(v, words)) { v.add(e.abbr); e.abbr.split("/").forEach((x) => v.add(x)); }
      else if (abbrPresent && contextOk) words.forEach((w) => v.add(w));
    }
  }
  // initialisms of capitalised phrases the candidate wrote ("Net Promoter Score" => nps), for any contiguous run of 2 to 6 words
  const LINK = new Set(["of", "and", "the", "for", "in", "to", "&"]);
  for (const t of texts) {
    const toks = (t.match(/[A-Za-z][A-Za-z0-9&']*|&/g) ?? []);
    for (let a = 0; a < toks.length; a++) {
      let initials = "", withLinks = "";   // "Voice of Customer" is written VC or VoC depending on the author: allow both
      for (let b = a; b < Math.min(toks.length, a + 7); b++) {
        const w = toks[b];
        if (LINK.has(w.toLowerCase())) { withLinks += w[0].toLowerCase(); continue; }
        if (!/^[A-Z]/.test(w)) break;
        initials += w[0].toLowerCase(); withLinks += w[0].toLowerCase();
        if (initials.length >= 2) v.add(initials);
        if (withLinks.length >= 2) v.add(withLinks);
      }
    }
    // "Customer Success Manager (CSM)": the written abbreviation joins the vocabulary through the plain word pass, and its
    // phrase is already there, so both directions are allowed
  }
}

const WORD = /[A-Za-z][A-Za-z0-9+#]*(?:[.\-/&'][A-Za-z0-9+#]+)*/g;
const parts = (w: string) => w.toLowerCase().split(/[.\-/&']/).filter(Boolean);

/** Every word the candidate's own profile uses, lower-cased, including the pieces of hyphenated and dotted terms. */
export function vocabulary(p: MasterProfile): Set<string> {
  const texts = [
    p.basics.name, p.basics.headline, p.basics.summary, p.basics.location, ...p.basics.links, ...p.preferences.roles,
    ...p.experience.flatMap((e) => [e.title, e.company, e.location ?? "", ...e.bullets.map((b) => b.text)]),
    ...p.education.flatMap((e) => [e.degree, e.school]),
    ...p.skills.map((s) => s.name), ...p.certifications.map((c) => c.name),
    p.basics.credentials ?? "", p.basics.workStatus ?? "",
    ...(p.highlights ?? []).map((h) => h.text), ...(p.caseStudies ?? []).map((c) => c.title),
    ...(p.development ?? []).map((d) => d.name), ...(p.awards ?? []).map((a) => a.name),
  ];
  const v = new Set<string>();
  for (const t of texts) for (const w of t.match(WORD) ?? []) { v.add(w.toLowerCase()); parts(w).forEach((x) => v.add(x)); }
  addEquivalents(v, texts);
  return v;
}

/** Well-known tools, platforms, languages and methods. Naming one that the profile never mentions is always a fabrication. */
const KNOWN_TERMS = new Set(`agile scrum kanban safe lean six sigma prince2 pmp itil devops sre ci cd
python java javascript typescript golang rust kotlin swift scala ruby php perl matlab sql nosql graphql html css sass
react angular vue svelte nextjs nodejs django flask spring rails laravel dotnet net
aws azure gcp kubernetes k8s docker terraform ansible jenkins git github gitlab bitbucket
postgres postgresql mysql mongodb redis kafka spark hadoop snowflake bigquery redshift databricks airflow dbt elasticsearch
tableau looker powerbi excel sheets amplitude mixpanel heap segment hotjar optimizely fullstory ga4
jira confluence asana trello notion figma sketch miro slack linear
salesforce hubspot zendesk intercom marketo eloqua netsuite sap oracle workday servicenow stripe twilio shopify
tensorflow pytorch sklearn pandas numpy opencv llm gpt openai rag
android ios flutter reactnative unity unreal
cissp cisa cism ccna ccnp aws-certified cfa cpa frm mba phd`.split(/\s+/));

/** Capitalised everywhere in ordinary prose, so never a sign of an invented name. */
const ALWAYS_OK = new Set("i dear hiring manager team recruiter recruiting recruitment talent acquisition human resources department sincerely regards kind best yours faithfully warm thank thanks respectfully january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday".split(" "));

const STOP_HEADLINE = new Set("and or of the for at in with to a an on & | - the".split(" "));

type Tok = { raw: string; start: number };
const tokens = (text: string): Tok[] => [...text.matchAll(WORD)].map((m) => ({ raw: m[0], start: m.index ?? 0 }));

/**
 * Words in `text` that look like names, tools or acronyms but appear nowhere in the candidate's profile (or the extra
 * allowed words, e.g. the target company and role). A capitalised word that merely starts a sentence is ignored unless
 * it is a well-known tool or method. This catches "used Kubernetes", "at Acme" and "AWS certified" being invented.
 */
export function unknownTerms(text: string, vocab: Set<string>, extra: Set<string> = new Set()): string[] {
  const known = (w: string) => { const l = w.toLowerCase(); return vocab.has(l) || extra.has(l) || parts(w).every((x) => vocab.has(x) || extra.has(x)); };
  const out = new Set<string>();
  for (const { raw, start } of tokens(text)) {
    // previous meaningful character, found by scanning back (slicing the text per word would be quadratic)
    let i = start - 1;
    while (i >= 0 && /[\s"'(\[]/.test(text[i])) i--;
    const sentenceStart = i < 0 || /[.!?:;\n\u2022\-]/.test(text[i]) || text.slice(i + 1, start).includes("\n");
    const capitalised = /^[A-Z]/.test(raw);
    const mixed = /[A-Z]/.test(raw.slice(1)) || /\d/.test(raw);
    const acronym = raw.length >= 2 && raw === raw.toUpperCase() && /[A-Z]/.test(raw);
    const tool = parts(raw).some((x) => KNOWN_TERMS.has(x)) || KNOWN_TERMS.has(raw.toLowerCase().replace(/[.\-\s]/g, ""));
    const suspicious = tool || mixed || acronym || (capitalised && !sentenceStart);
    if (suspicious && !ALWAYS_OK.has(parts(raw)[0]) && !known(raw)) out.add(raw);
  }
  return [...out];
}

/** Headline: every word must be the candidate's own (no added seniority, titles or domains). */
export function headlineProblems(headline: string, vocab: Set<string>): string[] {
  return [...new Set(tokens(headline).map((t) => t.raw).filter((w) => !STOP_HEADLINE.has(w.toLowerCase()) && !parts(w).every((x) => vocab.has(x))))];
}

type Ctx = { vocab: Set<string>; extra: Set<string> };

function checkText(
  where: string,
  text: string,
  ids: string[],
  facts: Map<string, string>,
  out: VerifyIssue[],
  mapping: Record<string, string[]>,
  ctx: Ctx,
) {
  if (ids.length === 0) {
    out.push({ where, problem: "no source fact cited" });
    return;
  }
  const unknown = ids.filter((id) => !facts.has(id));
  if (unknown.length) out.push({ where, problem: `unknown fact id(s): ${unknown.join(", ")}` });
  const known = ids.filter((id) => facts.has(id));
  mapping[where] = known;
  const sourceNums = new Set(known.flatMap((id) => numbersIn(facts.get(id) ?? "")));
  const stray = numbersIn(text).filter((n) => !sourceNums.has(n));
  if (stray.length) out.push({ where, problem: `number(s) not in cited sources: ${[...new Set(stray)].join(", ")}` });
  const unknownWords = unknownTerms(text, ctx.vocab, ctx.extra);
  if (unknownWords.length) out.push({ where, problem: `term(s) not found anywhere in the candidate's profile: ${unknownWords.join(", ")}` });
}

const wordsOf = (s: string) => new Set((s.match(WORD) ?? []).flatMap((w) => [w.toLowerCase(), ...parts(w)]));

/**
 * `allow` = extra words that are true by construction (the target company and role). Everything else must come from the profile.
 */
export function verifyTailored(p: MasterProfile, t: TailoredResume, allow: string[] = []): VerifyResult {
  const facts = factIndex(p);
  const issues: VerifyIssue[] = [];
  const mapping: Record<string, string[]> = {};
  const expIds = new Set(p.experience.map((e) => e.id));
  const ctx: Ctx = { vocab: vocabulary(p), extra: wordsOf(allow.join(" ")) };
  // which role each experience/bullet fact belongs to, so a bullet cannot be moved under a different employer
  const owner = new Map<string, string>();
  for (const e of p.experience) { owner.set(e.id, e.id); for (const b of e.bullets) owner.set(b.id, e.id); }

  const headlineBad = headlineProblems(t.headline, ctx.vocab);
  if (headlineBad.length) issues.push({ where: "headline", problem: `headline uses term(s) not in the candidate's profile: ${headlineBad.join(", ")}` });
  checkText("summary", t.summary.text, t.summary.sourceIds, facts, issues, mapping, ctx);
  for (const e of t.experience) {
    if (!expIds.has(e.experienceId)) {
      issues.push({ where: e.experienceId, problem: "experience id not in master profile" });
      continue;
    }
    e.bullets.forEach((b, i) => {
      const where = `${e.experienceId}#${i}`;
      checkText(where, b.text, b.sourceIds, facts, issues, mapping, ctx);
      const foreign = b.sourceIds.filter((id) => owner.has(id) && owner.get(id) !== e.experienceId);
      if (foreign.length) issues.push({ where, problem: `cites fact(s) from a different role (${foreign.join(", ")}); a bullet may only describe the role it is listed under` });
    });
  }
  const skillIds = new Set(p.skills.map((s) => s.id));
  for (const id of t.skillIds) if (!skillIds.has(id)) issues.push({ where: id, problem: "skill id not in master profile" });
  const highlightIds = new Set((p.highlights ?? []).map((h) => h.id));
  for (const id of t.highlightIds ?? []) if (!highlightIds.has(id)) issues.push({ where: id, problem: "career highlight id not in master profile" });
  const certIds = new Set(p.certifications.map((c) => c.id));
  for (const id of t.certificationIds) if (!certIds.has(id)) issues.push({ where: id, problem: "certification id not in master profile" });
  return { ok: issues.length === 0, issues, mapping };
}

export function verifyCoverLetter(p: MasterProfile, c: CoverLetter, allow: string[] = []): VerifyResult {
  const facts = factIndex(p);
  const issues: VerifyIssue[] = [];
  const mapping: Record<string, string[]> = {};
  checkText("cover_letter", c.text, c.sourceIds, facts, issues, mapping, { vocab: vocabulary(p), extra: wordsOf(allow.join(" ")) });
  return { ok: issues.length === 0, issues, mapping };
}

/** Per-bullet original vs tailored, for the audit trail. */
export function buildDiff(p: MasterProfile, t: TailoredResume) {
  const facts = factIndex(p);
  return t.experience.flatMap((e) =>
    e.bullets.map((b) => ({
      experienceId: e.experienceId,
      tailored: b.text,
      original: b.sourceIds.map((id) => facts.get(id)).filter(Boolean),
      changed: !b.sourceIds.some((id) => facts.get(id) === b.text),
    })),
  );
}
