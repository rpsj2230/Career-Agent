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
  return m;
}

/** Numbers (incl. %, decimals, thousands separators) normalised for comparison. */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?%?/g) ?? []).map((n) => n.replace(/,/g, ""));
}

function checkText(
  where: string,
  text: string,
  ids: string[],
  facts: Map<string, string>,
  out: VerifyIssue[],
  mapping: Record<string, string[]>,
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
  if (stray.length) out.push({ where, problem: `number(s) not in cited sources: ${stray.join(", ")}` });
}

export function verifyTailored(p: MasterProfile, t: TailoredResume): VerifyResult {
  const facts = factIndex(p);
  const issues: VerifyIssue[] = [];
  const mapping: Record<string, string[]> = {};
  const expIds = new Set(p.experience.map((e) => e.id));

  checkText("summary", t.summary.text, t.summary.sourceIds, facts, issues, mapping);
  for (const e of t.experience) {
    if (!expIds.has(e.experienceId)) {
      issues.push({ where: e.experienceId, problem: "experience id not in master profile" });
      continue;
    }
    e.bullets.forEach((b, i) =>
      checkText(`${e.experienceId}#${i}`, b.text, b.sourceIds, facts, issues, mapping),
    );
  }
  const skillIds = new Set(p.skills.map((s) => s.id));
  for (const id of t.skillIds) if (!skillIds.has(id)) issues.push({ where: id, problem: "skill id not in master profile" });
  const certIds = new Set(p.certifications.map((c) => c.id));
  for (const id of t.certificationIds) if (!certIds.has(id)) issues.push({ where: id, problem: "certification id not in master profile" });
  return { ok: issues.length === 0, issues, mapping };
}

export function verifyCoverLetter(p: MasterProfile, c: CoverLetter): VerifyResult {
  const facts = factIndex(p);
  const issues: VerifyIssue[] = [];
  const mapping: Record<string, string[]> = {};
  checkText("cover_letter", c.text, c.sourceIds, facts, issues, mapping);
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
