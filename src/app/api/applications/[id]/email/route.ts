import { NextResponse } from "next/server";
import { z } from "zod";
import { sendApplicationEmail, writeEmailDraft } from "@/lib/apply/application-email";
import { loadDraft, saveDraft } from "@/lib/apply/email-store";
import { contactEmailsFor } from "@/lib/apply/contact-email";
import { db, must } from "@/lib/db";
import { runStructured } from "@/lib/llm/registry";
import { getSetting } from "@/lib/settings";
import { within } from "@/lib/time-limit";
import type { Runner } from "@/lib/tailor/tailor";
import { styleFor } from "@/lib/tailor/template";

export const maxDuration = 60;

const Addr = z.string().trim().toLowerCase().max(200).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "That is not an email address");
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), to: Addr.optional(), subject: z.string().trim().min(3).max(140).optional(), body: z.string().trim().min(20).max(6000).optional(), auto: z.boolean().optional() }),
  z.object({ action: z.literal("write"), to: Addr.optional() }),
  z.object({ action: z.literal("send"), to: Addr.optional(), override: z.boolean().optional(), resend: z.boolean().optional() }),
]);

type JobRow = { id: string; title: string; company: string; description: string; url: string; apply_type: string; country?: string | null; portal?: string | null };

/** The email that goes with one application: read it, edit it, write it again, or send it now (with the resume and cover letter attached). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json({ draft: await loadDraft(id) });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const b = parsed.data;
  const app = must<{ id: string; job_id: string; status: string } | null>(await db().from("applications").select("id,job_id,status").eq("id", id).maybeSingle(), "load application");
  if (!app) return NextResponse.json({ error: "Application not found" }, { status: 404 });

  if (b.action === "save") {
    const d = await loadDraft(id);
    if (!d) return NextResponse.json({ error: "There is no email yet. Write it first." }, { status: 404 });
    const changedText = (b.subject !== undefined && b.subject !== d.subject) || (b.body !== undefined && b.body !== d.body);
    await saveDraft(id, { ...d, to: b.to ?? d.to, subject: b.subject ?? d.subject, body: b.body ?? d.body, auto: b.auto ?? d.auto, ...(changedText ? { verified: true, edited: true, issues: [] } : {}) });
    return NextResponse.json({ ok: true });
  }

  if (b.action === "send") {
    if (["approved", "submitting"].includes(app.status)) return NextResponse.json({ error: "This application is being sent right now." }, { status: 409 });
    const r = await sendApplicationEmail(id, { actor: "user", to: b.to, override: b.override, resend: b.resend });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
    return NextResponse.json({ ok: true, to: r.to, note: r.already ? `Already sent to ${r.to}.` : `Emailed to ${r.to} with your resume and cover letter attached.` });
  }

  // write: a new email, optionally to an address you type (any job can be emailed, even if the posting lists none)
  const job = must<JobRow | null>(await db().from("jobs").select("*").eq("id", app.job_id).maybeSingle(), "load job");
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (!b.to && contactEmailsFor(job).length === 0 && !(await loadDraft(id))) return NextResponse.json({ error: "The posting lists no email address. Type the address to write to." }, { status: 422 });
  const work = (async (): Promise<Response> => {
    try {
      const prev = await loadDraft(id);
      const style = styleFor(job.country, (await getSetting("resume_templates").catch(() => ({}))) as Record<string, string>);
      const d = await writeEmailDraft(id, { job: job as never, run: runStructured as unknown as Runner, style, to: b.to ?? prev?.to });
      if (!d) return NextResponse.json({ error: "No recipient address." }, { status: 422 });
      return NextResponse.json({ ok: true, note: `Email written for ${d.to}${d.verified ? "" : ", but some claims could not be verified: review it before sending"}.` });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Could not write the email" }, { status: 422 });
    }
  })();
  return within(work, 55_000, () => NextResponse.json({ ok: true, note: "Writing the email is taking longer than a web request allows. Refresh in a minute." }));
}
