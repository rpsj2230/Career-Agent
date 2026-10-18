import "server-only";
import { logActivity } from "@/lib/activity";
import { loadEffectiveCountries } from "@/lib/country-config-store";
import { preflight } from "./preflight";
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
import { tailorResumeSmart, writeCoverLetterSmart, type Runner, type SmartOutcome } from "@/lib/tailor/tailor";
import { buildDiff } from "@/lib/docs/verify";
import { masterAsTailored } from "@/lib/tailor/sections";
import { applyScope, DEFAULT_SCOPE } from "@/lib/tailor/scope";
import { loadMasterFile } from "@/lib/tailor/master-store";
import { buildAnswers } from "./answers";
import { contactEmailsFor } from "./contact-email";
import { writeEmailDraft } from "./application-email";
import { loadDraft } from "./email-store";
import { emailModeFor } from "./route";
import { buildJobSnapshot, buildProfileSnapshot } from "./snapshot";
import { logEvent } from "./events";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function nextVersion(jobId: string, kind: string): Promise<number> {
  const rows = must<{ version: number }[]>(await db().from("documents").select("version").eq("job_id", jobId).eq("kind", kind), "load versions");
  return rows.reduce((m, r) => Math.max(m, r.version), 0) + 1;
}

const PDF = "application/pdf";
async function upload(path: string, buf: Buffer, contentType = DOCX) {
  const { error } = await db().storage.from("documents").upload(path, buf, { contentType, upsert: true });
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
export type PrepareOptions = {
  /** write new documents for a job that already has an application, and put that application back to "prepared" */
  regenerate?: boolean;
  /** your own steer for this resume ("stress my SQL work"); a preference, never a fact, so the checker still applies */
  guidance?: string;
  /** an application that was already sent may be regenerated only when you confirm it */
  confirmSubmitted?: boolean;
};

export async function prepareApplication(jobId: string, runId: string | null = null, opts: PrepareOptions = {}): Promise<{ applicationId: string; verified: boolean }> {
  const existing = must<{ id: string; status: string; submitted_at: string | null; submission?: unknown } | null>(
    await withLegacyFallback(
      () => db().from("applications").select("id,status,submitted_at,submission").eq("job_id", jobId).maybeSingle(),
      () => db().from("applications").select("id,status,submitted_at").eq("job_id", jobId).maybeSingle(),
    ), "check existing");
  if (existing && !opts.regenerate) return existingResult(existing.id);
  if (existing && ["approved", "submitting"].includes(existing.status)) throw new Error("This application is being sent right now. Wait until it finishes, then regenerate.");
  if (existing && existing.status === "submitted" && !opts.confirmSubmitted) throw new Error("This application was already submitted. Confirm that you want to prepare a new version and apply again.");
  const guidance = opts.guidance?.trim().slice(0, 600) || undefined;

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
  if (!existing) await preflight(job as Parameters<typeof preflight>[0], { profile, countryRules: (await loadEffectiveCountries().catch(() => null))?.countries, blocklist: await getSetting("blocklist") });
  if (profile.experience.length === 0) throw new Error("Profile is empty: import and confirm your resume first");
  const bank = must<{ question: string; answer: string }[]>(await db().from("answer_bank").select("question,answer"), "load answer bank");
  const countryPref = job.country ? (await listCountryPrefs().catch(() => ({ rows: [] as CountryPref[] }))).rows.find((c) => c.country === job.country!.toLowerCase()) : undefined;
  const run = runStructured as unknown as Runner;
  const style = styleFor(job.country, (await getSetting("resume_templates").catch(() => ({}))) as Record<string, string>);

  // memory: reuse or adapt a resume made for a similar job before spending tokens on a fresh one
  // regenerating writes a new resume from scratch: it must not hand back the one you wanted replaced
  const library: Library = opts.regenerate ? { past: [], enabled: false } : await loadLibrary(jobId).catch(() => ({ past: [], enabled: false }));
  let resume: SmartOutcome;
  let cover: Awaited<ReturnType<typeof writeCoverLetterSmart>> | null;
  // when no model can write a tailored resume, your own master resume is used instead of leaving the application undone
  let master: { reason: string; file: { bytes: Buffer; ext: string } | null } | null = null;
  try {
    resume = await tailorResumeSmart(profile, { ...job, style, guidance }, run, library);
    const prov0 = resume.provenance;
    // a cover letter is about one company: it is only carried over when the old job was near-identical
    const carryFrom = prov0.mode === "reused" && prov0.from && prov0.from.similarity >= (library.thresholds?.reuse ?? DEFAULT_THRESHOLDS.reuse) ? library.past.find((p) => p.jobId === prov0.from!.jobId) : undefined;
    cover = await writeCoverLetterSmart(profile, { ...job, style, guidance }, run, carryFrom?.cover ? { text: carryFrom.cover.text, sourceIds: carryFrom.cover.sourceIds, fromCompany: carryFrom.company, fromTitle: carryFrom.title } : null);
  } catch (e) {
    // regenerating must never replace a good resume with the plain master one: leave the application exactly as it was
    if (opts.regenerate) throw new Error(`No new resume could be written (${(e instanceof Error ? e.message : String(e)).slice(0, 200)}). The existing resume is unchanged; try again when a model is available.`);
    const file = await loadMasterFile().catch(() => null);
    master = { reason: (e instanceof Error ? e.message : String(e)).slice(0, 300), file: file ? { bytes: file.bytes, ext: file.ext } : null };
    const content = masterAsTailored(profile);
    resume = { content, model: "master", verification: { ok: true, issues: [], attempts: 0 }, diff: buildDiff(profile, content), provenance: { mode: "fresh", modelCalls: 0, tokensSavedEstimate: 0 } } as unknown as SmartOutcome;
    cover = null;
  }
  if (!master) {
    // parts you locked on the Resumes page stay exactly as in your master resume
    const scope = await getSetting("tailoring_scope").catch(() => null);
    if (scope) { const content = applyScope(resume.content, profile, { ...DEFAULT_SCOPE, ...scope }); if (content !== resume.content) resume = { ...resume, content, diff: buildDiff(profile, content) }; }
  }
  const prov = resume.provenance;

  // Two requests can prepare the same job at once (a double click, or the pipeline and a button). The database allows one
  // application per job; the loser finds the winner's application and returns it instead of failing.
  let app: { id: string };
  let rv: number, cv: number, resumePath: string, coverPath: string;
  let appRow: { job_id: string; resume_doc_id: string; cover_doc_id: string | null; answers: unknown[]; status: string };
  try {
    rv = await nextVersion(jobId, "resume");
    cv = await nextVersion(jobId, "cover_letter");
    const ext = master?.file?.ext ?? "docx";
    resumePath = `${jobId}/resume-v${rv}.${ext}`;
    coverPath = `${jobId}/cover-letter-v${cv}.docx`;
    // the master file is sent exactly as you uploaded it; otherwise the resume is laid out from the template
    if (master?.file) await upload(resumePath, master.file.bytes, ext === "pdf" ? PDF : DOCX);
    else await upload(resumePath, await renderResumeDocx(profile, resume.content, style));
    if (cover) await upload(coverPath, await renderCoverLetterDocx(profile, cover.content, job.company, style));

    const resumeDoc = must<{ id: string }>(
      await db().from("documents").insert({ job_id: jobId, kind: "resume", version: rv, content: resume.content, diff: resume.diff, verification: { ...resume.verification, reuse: prov, quality: master ? undefined : resume.quality, style: style.id, ...(master ? { fallback: master.file ? "master_original" : "master_profile", reason: master.reason } : {}) }, storage_path: resumePath, model: resume.model }).select("id").single(),
      "save resume doc",
    );
    const coverDoc = !cover ? null : must<{ id: string }>(
      await db().from("documents").insert({ job_id: jobId, kind: "cover_letter", version: cv, content: cover.content, verification: { ...cover.verification, reuse: cover.carried ? { mode: "reused", modelCalls: 0, tokensSavedEstimate: 1500 } : { mode: "fresh", modelCalls: cover.verification.attempts, tokensSavedEstimate: 0 } }, storage_path: coverPath, model: cover.model }).select("id").single(),
      "save cover doc",
    );
    const scoreRow = must<{ score: number; model: string | null; detail: { summary?: string; matchedSkills?: string[]; gaps?: string[] } } | null>(
      await db().from("job_scores").select("score,model,detail").eq("job_id", jobId).maybeSingle(), "load score",
    );
    appRow = { job_id: jobId, resume_doc_id: resumeDoc.id, cover_doc_id: coverDoc?.id ?? null, answers: buildAnswers(bank, profile.preferences, profile, countryAnswers(countryPref), job.country), status: "prepared" };
    const snapshots = { job_snapshot: buildJobSnapshot(job, scoreRow), profile_snapshot: buildProfileSnapshot(profile), run_id: runId };
    if (existing) {
      // a new version for the same application: the old documents stay in the history, the status goes back to "prepared"
      const fresh = { resume_doc_id: appRow.resume_doc_id, cover_doc_id: appRow.cover_doc_id, answers: appRow.answers, status: "prepared", method: null, approved_at: null, submitted_at: null, error: null, screenshot_path: null };
      must(
        await withLegacyFallback(
          () => db().from("applications").update({ ...fresh, ...snapshots, submission: null }).eq("id", existing.id).select("id"),
          () => db().from("applications").update(fresh).eq("id", existing.id).select("id"),
        ), "update application");
      app = { id: existing.id };
    } else app = must<{ id: string }>(
      await withLegacyFallback(
        () => db().from("applications").insert({
          ...appRow, portal: job.portal ?? job.source?.split(":")[0] ?? null, country: job.country ?? null,
          ...snapshots,
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
  // a posting that lists an email address (or asks for applications by email) also gets an email with the resume, cover letter and a message on why you fit
  if (!master && (await getSetting("email_apply")).enabled) {
    try {
      const prev = existing ? await loadDraft(app.id) : null; // a recipient you typed yourself is kept when the resume is regenerated
      const contacts = contactEmailsFor(job);
      const mode = emailModeFor(job, contacts.length > 0 || !!prev);
      if (mode && (mode === "only" || prev || (await getSetting("email_apply")).also_when_listed)) await writeEmailDraft(app.id, { job: job as never, run, style, guidance, contacts, to: prev?.to });
    } catch (e) {
      await logActivity({ kind: "email.drafted", level: "warn", message: `Could not write the application email for ${job.title} at ${job.company}: ${e instanceof Error ? e.message : e}`, ...jobLogFields(job), application_id: app.id, status: "failed" }).catch(() => undefined);
    }
  }
  const verified = resume.verification.ok && (cover?.verification.ok ?? true);
  const ref = { ...jobLogFields(job), application_id: app.id, run_id: runId };
  const how = prov.mode === "reused" ? ` (reused from "${prov.from?.title}" at ${prov.from?.company}, ${Math.round((prov.from?.similarity ?? 0) * 100)}% similar; no model call)` : prov.mode === "adapted" ? ` (adapted from "${prov.from?.title}" at ${prov.from?.company}, ${Math.round((prov.from?.similarity ?? 0) * 100)}% similar)` : "";
  if (master) await logActivity({ kind: "resume.generated", level: "warn", message: `No tailored resume could be made for ${job.title} at ${job.company}, so ${master.file ? "your uploaded master resume" : "your master profile laid out in the standard template"} is attached instead. Reason: ${master.reason}`, ...ref, status: "master_fallback", detail: { fallback: master.file ? "master_original" : "master_profile", reason: master.reason } });
  await logActivity({ kind: "resume.generated", level: resume.verification.ok ? "info" : "warn", message: `Resume v${rv} for ${job.title} at ${job.company}${how}${resume.verification.ok ? "" : ` (${resume.verification.issues.length} claim(s) failed verification)`}`, ...ref, status: resume.verification.ok ? "verified" : "unverified", detail: { version: rv, model: resume.model, attempts: resume.verification.attempts, issues: resume.verification.issues, path: resumePath, memory: prov } });
  if (cover) await logActivity({ kind: "cover.generated", level: cover.verification.ok ? "info" : "warn", message: `Cover letter v${cv} for ${job.title} at ${job.company}${cover.carried ? " (carried over from a near-identical job)" : ""}${cover.verification.ok ? "" : ` (${cover.verification.issues.length} claim(s) failed verification)`}`, ...ref, status: cover.verification.ok ? "verified" : "unverified", detail: { version: cv, model: cover.model, attempts: cover.verification.attempts, issues: cover.verification.issues, path: coverPath } });
  if (existing) await logEvent(app.id, "regenerated", { previousStatus: existing.status, previousSubmittedAt: existing.submitted_at, previousSubmission: existing.submission ?? null, guidance: guidance ?? null, resumeVersion: rv, coverVersion: cv });
  await logActivity({ kind: "application.prepared", message: `${existing ? "Regenerated: " : ""}Application prepared for ${job.title} at ${job.company}: ${verified ? "verified, awaiting your approval" : "needs your review (unverified claims)"}`, ...ref, status: "prepared", detail: { verified, answers: appRow.answers.length } });
  await logEvent(app.id, "prepared", { verified, resumeModel: resume.model, coverModel: cover?.model ?? null, resumeIssues: resume.verification.issues, coverIssues: cover?.verification.issues ?? [], fallback: master ? (master.file ? "master_original" : "master_profile") : null });
  return { applicationId: app.id, verified };
}
