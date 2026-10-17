import "server-only";
import { logActivity } from "@/lib/activity";
import { jobLogFields } from "@/lib/activity-helpers";
import { db, must } from "@/lib/db";
import { dedupeKey } from "@/lib/jobs/normalize";
import { checkPostingOpen } from "@/lib/jobs/posting";
import { enrichIfThin } from "@/lib/score/enrich";
import { prefilter, type Blocklist } from "@/lib/score/prompt";
import type { EffectiveCountry } from "@/lib/country-config";
import type { MasterProfile } from "@/lib/types";

/** An application that should not be prepared (the job is gone, no longer fits, or you already applied). Not a failure: the job is closed out with the reason. */
export class PreflightStop extends Error {
  constructor(message: string, public code: "closed" | "no_longer_fits" | "already_applied") { super(message); this.name = "PreflightStop"; }
}

type JobRow = { id: string; title: string; company: string; url: string; description: string; country?: string | null; location?: string | null; salary_text?: string | null; source?: string | null; portal?: string | null };

async function close(job: JobRow, code: PreflightStop["code"], reason: string): Promise<never> {
  must(await db().from("jobs").update({ status: "skipped", skip_reason: reason }).eq("id", job.id).select("id"), "close job");
  await logActivity({ kind: "job.rejected", level: "info", message: `Not prepared: ${reason}`, status: code, ...jobLogFields(job), detail: { stage: "preflight", code, title: job.title } });
  throw new PreflightStop(reason, code);
}

/**
 * Checks made just before an application is prepared, when the job may be days old: the posting must still be open, it must still
 * pass your rules on its full description, and you must not have applied to the same role through another listing.
 * Throws PreflightStop (after closing the job with the reason) when it should not go on.
 */
export async function preflight(job: JobRow, o: { profile: MasterProfile; countryRules?: EffectiveCountry[]; blocklist: Blocklist }): Promise<void> {
  const open = await checkPostingOpen(job.url).catch(() => ({ open: null as boolean | null }));
  if (open.open === false) await close(job, "closed", `The posting is no longer open: ${(open as { reason?: string }).reason ?? "closed"}`);

  // a thin description may have been completed since scoring; the rules are checked again on the full text
  const full = await enrichIfThin(job);
  if (full) job.description = full;
  const reason = prefilter({ title: job.title, company: job.company, country: job.country ?? null, location: job.location ?? null, description: job.description, salary_text: job.salary_text ?? null, source: job.source }, o.profile, o.countryRules, o.blocklist);
  if (reason) await close(job, "no_longer_fits", `On a second look it no longer fits: ${reason}`);

  const key = dedupeKey(job.company, job.title, job.country ?? undefined);
  const same = must<{ id: string; applications: { status: string }[] | { status: string } | null }[]>(
    await db().from("jobs").select("id, applications(status)").eq("dedupe_key", key).neq("id", job.id).limit(20), "check earlier applications");
  const applied = same.some((j) => [j.applications].flat().some((a) => a && ["submitted", "submitting", "approved", "assisted_pending"].includes(a.status)));
  if (applied) await close(job, "already_applied", "You already applied for this role through another listing");
}
