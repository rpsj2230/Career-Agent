import "server-only";
import { db, must } from "@/lib/db";
import { runStructured } from "@/lib/llm/registry";
import { getProfile } from "@/lib/profile/store";
import { renderCoverLetterDocx, renderResumeDocx } from "@/lib/tailor/docx";
import { tailorResume, writeCoverLetter, type Runner } from "@/lib/tailor/tailor";
import { buildAnswers } from "./answers";
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

/** Tailor resume + cover letter for a queued job and create the application package for review. */
export async function prepareApplication(jobId: string): Promise<{ applicationId: string; verified: boolean }> {
  const existing = must<{ id: string } | null>(await db().from("applications").select("id").eq("job_id", jobId).maybeSingle(), "check existing");
  if (existing) return { applicationId: existing.id, verified: true };

  const job = must<{ id: string; title: string; company: string; description: string }>(
    await db().from("jobs").select("id,title,company,description").eq("id", jobId).single(), "load job",
  );
  const profile = await getProfile();
  if (profile.experience.length === 0) throw new Error("Profile is empty: import and confirm your resume first");
  const bank = must<{ question: string; answer: string }[]>(await db().from("answer_bank").select("question,answer"), "load answer bank");
  const run = runStructured as unknown as Runner;

  const resume = await tailorResume(profile, job, run);
  const cover = await writeCoverLetter(profile, job, run);

  const rv = await nextVersion(jobId, "resume");
  const cv = await nextVersion(jobId, "cover_letter");
  const resumePath = `${jobId}/resume-v${rv}.docx`;
  const coverPath = `${jobId}/cover-letter-v${cv}.docx`;
  await upload(resumePath, await renderResumeDocx(profile, resume.content));
  await upload(coverPath, await renderCoverLetterDocx(profile, cover.content, job.company));

  const resumeDoc = must<{ id: string }>(
    await db().from("documents").insert({ job_id: jobId, kind: "resume", version: rv, content: resume.content, diff: resume.diff, verification: resume.verification, storage_path: resumePath, model: resume.model }).select("id").single(),
    "save resume doc",
  );
  const coverDoc = must<{ id: string }>(
    await db().from("documents").insert({ job_id: jobId, kind: "cover_letter", version: cv, content: cover.content, verification: cover.verification, storage_path: coverPath, model: cover.model }).select("id").single(),
    "save cover doc",
  );
  const app = must<{ id: string }>(
    await db().from("applications").insert({ job_id: jobId, resume_doc_id: resumeDoc.id, cover_doc_id: coverDoc.id, answers: buildAnswers(bank, profile.preferences, profile), status: "prepared" }).select("id").single(),
    "create application",
  );
  must(await db().from("jobs").update({ status: "prepared" }).eq("id", jobId).select("id"), "mark prepared");
  const verified = resume.verification.ok && cover.verification.ok;
  await logEvent(app.id, "prepared", { verified, resumeModel: resume.model, coverModel: cover.model, resumeIssues: resume.verification.issues, coverIssues: cover.verification.issues });
  return { applicationId: app.id, verified };
}
