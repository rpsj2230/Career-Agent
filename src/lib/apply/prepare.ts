import "server-only";
import { logActivity } from "@/lib/activity";
import { upgradeApplyTarget } from "@/lib/jobs/resolve-url";
import type { ApplyType } from "@/lib/jobs/normalize";
import { jobLogFields } from "@/lib/activity-helpers";
import { db, must } from "@/lib/db";
import { withLegacyFallback } from "@/lib/schema";
import { runStructured } from "@/lib/llm/registry";
import { getProfile } from "@/lib/profile/store";
import { countryAnswers, type CountryPref } from "@/lib/country-prefs";
import { listCountryPrefs } from "@/lib/country-prefs-store";
import { styleFor } from "@/lib/tailor/template";
import { getSetting } from "@/lib/settings";
import { renderCoverLetterDocx, renderResumeDocx } from "@/lib/tailor/docx";
import { loadLibrary } from "@/lib/tailor/memory-store";
import { DEFAULT_THRESHOLDS, type Library } from "@/lib/tailor/memory";
import { tailorResumeSmart, writeCoverLetterSmart, type Runner } from "@/lib/tailor/tailor";
import { buildAnswers } from "./answers";
import { buildJobSnapshot, buildProfileSnapshot } from "./snapshot";
import { logEvent } from "./events";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function nextVersion(jobId: string, kind: string): Promise<number> {
  const rows = must<{ version: number }[]>(await db().from("documents").select("version").eq("job_id", jobId).eq("kind", kind), "load versions");
  return rows.reduce((m, r) => Math.max(m, r.version), 0) + 1;
}

async function upload(path: string, buf: Buffer) {
  const { error } = await db().storage.from("documents").upload(path, buf, { contentType: DOCX, upsert: true });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
}

/** An application that already exists, with whether its documents passed verification (never assumed). */
async function existingResult(appId: string): Promise<{ applicationId: string; verified: boolean }> {
  const a = must<{ resume_doc_id: string | null; cover_doc_id: string | null }>(await db().from("applications").select("resume_doc_id,cover_doc_id").eq("id", appId).single(), "load application");
  const ids = [a.resume_doc_id, a.cover_doc_id].filter(Boolean) as string[];
  const docs = ids.length ? must<{ verification: { ok: boolean } | null }[]>(await db().from("documents").select("verification").in("id", ids), "load documents") : [];
  return { applicationId: appId, verified: docs.length > 0 && docs.every((d) => d.verification?.ok === true) };
}

/** Tailor resume + cover letter for a queued job and create the application package for review. */
export async function prepareApplication(jobId: string, runId: string | null = null): Promise<{ applicationId: string; verified: boolean }> {
  const existing = must<{ id: string } | null>(await db().from("applications").select("id").eq("job_id", jobId).maybeSingle(), "check existing");
  if (existing) return existingResult(existing.id);

  const job = must<{ id: string; title: string; company: string; description: string; url: string; apply_type: ApplyType; country?: string | null; portal?: string | null; source?: string | null }>(
    await db().from("jobs").select("*").eq("id", jobId).single(), "load job",
  );
  // an aggregator link that leads to the employer's own Greenhouse or Lever page: use that page, so it can be applied for automatically
  const upgraded = await upgradeApplyTarget(job).catch(() => null);
  if (upgraded) {
    const from = job.url;
    must(await db().from("jobs").update(upgraded).eq("id", jobId).select("id"), "update job link");
    Object.assign(job, upgraded);
    await logActivity({ kind: "job.link_resolved", message: `Found the employer's ${upgraded.apply_type === "greenhouse" ? "Greenhouse" : "Lever"} page for ${job.title} at ${job.company}: it can be applied for automatically`, ...jobLogFields(job), status: "resolved", detail: { from, to: upgraded.url, apply_type: upgraded.apply_type } });
  }
  const profile = await getProfile();
  if (profile.experience.length === 0) throw new Error("Profile is empty: import and confirm your resume first");
  const bank = must<{ question: string; answer: string }[]>(await db().from("answer_bank").select("question,answer"), "load answer bank");
  const countryPref = job.country ? (await listCountryPrefs().catch(() => ({ rows: [] as CountryPref[] }))).rows.find((c) => c.country === job.country!.toLowerCase()) : undefined;
  const run = runStructured as unknown as Runner;
  const style = styleFor(job.country, (await getSetting("resume_templates").catch(() => ({}))) as Record<string, string>);

  // memory: reuse or adapt a resume made for a similar job before spending tokens on a fresh one
  const library: Library = await loadLibrary(jobId).catch(() => ({ past: [], enabled: false }));
  const resume = await tailorResumeSmart(profile, { ...job, style }, run, library);
  const prov = resume.provenance;
  // a cover letter is about one company: it is only carried over when the old job was near-identical
  const carryFrom = prov.mode === "reused" && prov.from && prov.from.similarity >= (library.thresholds?.reuse ?? DEFAULT_THRESHOLDS.reuse) ? library.past.find((p) => p.jobId === prov.from!.jobId) : undefined;
  const cover = await writeCoverLetterSmart(profile, { ...job, style }, run, carryFrom?.cover ? { text: carryFrom.cover.text, sourceIds: carryFrom.cover.sourceIds, fromCompany: carryFrom.company, fromTitle: carryFrom.title } : null);

  // Two requests can prepare the same job at once (a double click, or the pipeline and a button). The database allows one
  // application per job; the loser finds the winner's application and returns it instead of failing.
  let app: { id: string };
  let rv: number, cv: number, resumePath: string, coverPath: string;
  let appRow: { job_id: string; resume_doc_id: string; cover_doc_id: string; answers: unknown[]; status: string };
  try {
    rv = await nextVersion(jobId, "resume");
    cv = await nextVersion(jobId, "cover_letter");
    resumePath = `${jobId}/resume-v${rv}.docx`;
    coverPath = `${jobId}/cover-letter-v${cv}.docx`;
    await upload(resumePath, await renderResumeDocx(profile, resume.content, style));
    await upload(coverPath, await renderCoverLetterDocx(profile, cover.content, job.company, style));

    const resumeDoc = must<{ id: string }>(
      await db().from("documents").insert({ job_id: jobId, kind: "resume", version: rv, content: resume.content, diff: resume.diff, verification: { ...resume.verification, reuse: prov, style: style.id }, storage_path: resumePath, model: resume.model }).select("id").single(),
      "save resume doc",
    );
    const coverDoc = must<{ id: string }>(
      await db().from("documents").insert({ job_id: jobId, kind: "cover_letter", version: cv, content: cover.content, verification: { ...cover.verification, reuse: cover.carried ? { mode: "reused", modelCalls: 0, tokensSavedEstimate: 1500 } : { mode: "fresh", modelCalls: cover.verification.attempts, tokensSavedEstimate: 0 } }, storage_path: coverPath, model: cover.model }).select("id").single(),
      "save cover doc",
    );
    const scoreRow = must<{ score: number; model: string | null; detail: { summary?: string; matchedSkills?: string[]; gaps?: string[] } } | null>(
      await db().from("job_scores").select("score,model,detail").eq("job_id", jobId).maybeSingle(), "load score",
    );
    appRow = { job_id: jobId, resume_doc_id: resumeDoc.id, cover_doc_id: coverDoc.id, answers: buildAnswers(bank, profile.preferences, profile, countryAnswers(countryPref)), status: "prepared" };
    app = must<{ id: string }>(
      await withLegacyFallback(
        () => db().from("applications").insert({
          ...appRow, portal: job.portal ?? job.source?.split(":")[0] ?? null, country: job.country ?? null,
          job_snapshot: buildJobSnapshot(job, scoreRow), profile_snapshot: buildProfileSnapshot(profile), run_id: runId,
        }).select("id").single(),
        () => db().from("applications").insert(appRow).select("id").single(),
      ),
      "create application",
    );
    must(await db().from("jobs").update({ status: "prepared" }).eq("id", jobId).select("id"), "mark prepared");
  } catch (e) {
    // a unique-key clash means another request is preparing this same job: wait for its application to appear
    const clash = /duplicate key|unique constraint/i.test(e instanceof Error ? e.message : String(e));
    for (let i = 0; i < (clash ? 20 : 1); i++) {
      const won = must<{ id: string } | null>(await db().from("applications").select("id").eq("job_id", jobId).maybeSingle(), "check existing");
      if (won) return existingResult(won.id);
      if (clash) await new Promise((r) => setTimeout(r, 500));
    }
    throw e;
  }
  const verified = resume.verification.ok && cover.verification.ok;
  const ref = { ...jobLogFields(job), application_id: app.id, run_id: runId };
  const how = prov.mode === "reused" ? ` (reused from "${prov.from?.title}" at ${prov.from?.company}, ${Math.round((prov.from?.similarity ?? 0) * 100)}% similar; no model call)` : prov.mode === "adapted" ? ` (adapted from "${prov.from?.title}" at ${prov.from?.company}, ${Math.round((prov.from?.similarity ?? 0) * 100)}% similar)` : "";
  await logActivity({ kind: "resume.generated", level: resume.verification.ok ? "info" : "warn", message: `Resume v${rv} for ${job.title} at ${job.company}${how}${resume.verification.ok ? "" : ` (${resume.verification.issues.length} claim(s) failed verification)`}`, ...ref, status: resume.verification.ok ? "verified" : "unverified", detail: { version: rv, model: resume.model, attempts: resume.verification.attempts, issues: resume.verification.issues, path: resumePath, memory: prov } });
  await logActivity({ kind: "cover.generated", level: cover.verification.ok ? "info" : "warn", message: `Cover letter v${cv} for ${job.title} at ${job.company}${cover.carried ? " (carried over from a near-identical job)" : ""}${cover.verification.ok ? "" : ` (${cover.verification.issues.length} claim(s) failed verification)`}`, ...ref, status: cover.verification.ok ? "verified" : "unverified", detail: { version: cv, model: cover.model, attempts: cover.verification.attempts, issues: cover.verification.issues, path: coverPath } });
  await logActivity({ kind: "application.prepared", message: `Application prepared for ${job.title} at ${job.company}: ${verified ? "verified, awaiting your approval" : "needs your review (unverified claims)"}`, ...ref, status: "prepared", detail: { verified, answers: appRow.answers.length } });
  await logEvent(app.id, "prepared", { verified, resumeModel: resume.model, coverModel: cover.model, resumeIssues: resume.verification.issues, coverIssues: cover.verification.issues });
  return { applicationId: app.id, verified };
}
