import { verifyCoverLetter, type VerifyResult } from "@/lib/docs/verify";
import { ApplicationEmail, type MasterProfile } from "@/lib/types";
import { assessCover, GOOD_ENOUGH, type CoverQuality } from "./quality";
import { factsBlock, feedback, jobBlock, RULES, type JobText, type Runner, type TailorOutcome } from "./tailor";

const SYSTEM = `You write the application email that carries a candidate's resume and cover letter to a hiring manager. Its whole purpose is to show, in a few seconds, WHY THIS CANDIDATE IS A STRONG FIT FOR THIS JOB.
${RULES}
Return "subject" and "body".
- subject: specific and professional, for example "Application: <role> - <candidate name>". No clickbait, at most 90 characters.
- body: plain text, 130 to 190 words, first person. Greeting ("Dear Hiring Manager," unless the posting names a person), then:
  1. one sentence naming the role and the strongest reason the candidate fits it;
  2. two or three short lines (a hyphen list is fine) each tying one of the job's main requirements to something the candidate has really done, with its exact result and figure from the facts, in the job's own terminology;
  3. what the candidate would bring to this team, a note that the resume and cover letter are attached, and an invitation to talk;
  4. a sign-off with the candidate's name.
Do not repeat the resume line by line, do not apologise, and never mention what the candidate lacks. Cite the fact ids used in "sourceIds".`;

export async function writeApplicationEmail(p: MasterProfile, job: JobText, run: Runner, maxAttempts = 3): Promise<TailorOutcome<ApplicationEmail, CoverQuality> & { quality: CoverQuality }> {
  const base = `CANDIDATE FACTS\n${factsBlock(p)}\nCandidate name: ${p.basics.name}\n\n${jobBlock(job)}`;
  let prompt = base;
  type Try = { out: ApplicationEmail; model: string; v: VerifyResult; q: CoverQuality };
  let best: Try | undefined;
  const better = (a: Try, b: Try | undefined) => !b || (a.v.ok !== b.v.ok ? a.v.ok : a.v.ok ? a.q.score > b.q.score : a.v.issues.length < b.v.issues.length);
  let attempts = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;
    const { output, model } = await run({ task: "tailor", schema: ApplicationEmail, system: SYSTEM, prompt, jobId: job.id });
    const v = verifyCoverLetter(p, { text: output.body, sourceIds: output.sourceIds }, [job.company, job.title, p.basics.name]);
    const q = assessCover(p, output.body, job, { maxWords: 230, kind: "email" });
    if (!/attach/i.test(output.body)) q.problems.push("Say that the resume and cover letter are attached.");
    if (!output.subject.trim() || output.subject.length > 100) q.problems.push("The subject must be present and at most 90 characters.");
    const cur: Try = { out: output, model, v, q: { ...q, score: q.problems.length > 0 ? Math.min(q.score, GOOD_ENOUGH - 1) : q.score } };
    if (better(cur, best)) best = cur;
    if (v.ok && cur.q.score >= GOOD_ENOUGH) break;
    if (attempt === maxAttempts) break;
    prompt = base + (v.ok ? `\n\nYOUR PREVIOUS EMAIL WAS ACCEPTED BUT CAN BE STRONGER (quality ${cur.q.score}/100). Improve it and return the full subject and body:\n${cur.q.problems.map((x) => `- ${x}`).join("\n")}` : feedback(v));
  }
  const b = best!;
  return { content: b.out, model: b.model, verification: { ...b.v, attempts }, quality: b.q };
}
