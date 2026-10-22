import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/app/action-button";
import { applyRoute } from "@/lib/apply/route";
import { EmailCard } from "@/components/app/email-card";
import { contactEmailsFor } from "@/lib/apply/contact-email";
import { loadDraft } from "@/lib/apply/email-store";
import { RegenerateCard } from "@/components/app/regenerate-card";
import { ReapplyCard } from "@/components/app/reapply-card";
import { ApplyTypeBadge, ScoreBadge, SourceBadge, StatusBadge } from "@/components/app/badges";
import { ResumePreview } from "@/components/app/resume-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { applicationProvenance } from "@/lib/apply/provenance";
import { changedSince, fmtBytes, shortHash, submissionView, summariseDiff, type DiffRow } from "@/lib/apply/detail";
import { db, must } from "@/lib/db";
import { countryLabel } from "@/lib/filters";
import { portalLabel } from "@/lib/jobs/portal";
import { getProfile } from "@/lib/profile/store";
import { styleById } from "@/lib/tailor/template";
import { masterAsTailored, resumeView } from "@/lib/tailor/sections";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { CoverLetter, MasterProfile, TailoredResume } from "@/lib/types";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Doc = { id: string; kind: string; version: number; content: any; diff: DiffRow[] | null; verification: { ok: boolean; issues: { where: string; problem: string }[]; style?: string; quality?: { score: number; keywordCoverage: number; bulletsRewritten: number; bulletsTotal: number; missing: string[]; gaps: string[]; headlineTailored: boolean; summaryTailored: boolean }; fallback?: string; reason?: string; reuse?: { mode: string; from?: { title: string; company: string; similarity: number } | null; modelCalls: number; tokensSavedEstimate: number } } | null; storage_path: string | null; model: string | null; created_at: string };

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <TableRow><TableCell className="w-48 align-top text-muted-foreground">{k}</TableCell><TableCell className="whitespace-normal break-words">{children}</TableCell></TableRow>
);
const Link2 = ({ href }: { href: string | null | undefined }) => (href ? <a className="break-all underline" href={href} target="_blank" rel="noreferrer">{href}</a> : <>-</>);

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = must<any | null>(await db().from("applications").select("*, job:jobs(*)").eq("id", id).maybeSingle(), "load application");
  if (!app) notFound();
  const live = app.job;
  const snap = app.job_snapshot ?? null;
  const job: Record<string, any> = snap ?? live;
  const liveScore = snap?.fit ? null : must<any | null>(await db().from("job_scores").select("score,detail,model").eq("job_id", app.job_id).maybeSingle(), "load score");
  const fit = snap?.fit ?? (liveScore ? { score: liveScore.score, model: liveScore.model, summary: liveScore.detail?.summary, matchedSkills: liveScore.detail?.matchedSkills ?? [], gaps: liveScore.detail?.gaps ?? [] } : null);
  const events = must<any[]>(await db().from("apply_events").select("*").eq("application_id", id).order("at", { ascending: true }), "load events");
  const docs = must<Doc[]>(await db().from("documents").select("id,kind,version,content,diff,storage_path,model,created_at,verification").eq("job_id", app.job_id).order("created_at", { ascending: true }), "load docs");
  const resume = docs.find((d) => d.id === app.resume_doc_id);
  const cover = docs.find((d) => d.id === app.cover_doc_id);
  const others = docs.filter((d) => d.id !== resume?.id && d.id !== cover?.id);

  const snapProfile = MasterProfile.safeParse(app.profile_snapshot?.profile);
  const profile = snapProfile.success ? snapProfile.data : await getProfile();
  const usingLiveProfile = !snapProfile.success;
  const tailoredParsed = resume ? TailoredResume.safeParse(resume.content) : null;
  const coverParsed = cover ? CoverLetter.safeParse(cover.content) : null;
  const style = styleById(resume?.verification?.style);
  const tailoredView = tailoredParsed?.success ? resumeView(profile, tailoredParsed.data, style) : null;
  const originalView = snapProfile.success ? resumeView(snapProfile.data, masterAsTailored(snapProfile.data)) : null;
  const diff = summariseDiff(resume?.diff);
  const sub = submissionView(app);
  const who = applicationProvenance({ status: app.status, method: app.method, submitted_at: app.submitted_at, submission: sub.kind === "record" ? sub.record : null }, events);
  const moved = changedSince(snap, live);
  const issues = [...(resume?.verification?.issues ?? []), ...(cover?.verification?.issues ?? [])];
  const emailDraft = await loadDraft(id).catch(() => null);
  const listedEmails = contactEmailsFor({ url: job.url, description: job.description, company: job.company }).map((c) => c.email);
  const route = applyRoute({ apply_type: job.apply_type, url: job.url, portal: job.portal, emailMode: emailDraft?.mode ?? null });
  const dl = (path: string | null | undefined, label: string) => path ? <Button asChild size="sm" variant="outline"><a href={`/api/files?path=${encodeURIComponent(path)}`}>{label}</a></Button> : null;

  return (
    <div className="grid gap-5">
      <div>
        <Link href="/applications" className="text-sm text-muted-foreground hover:underline">All applications</Link>
        <h1 className="text-2xl font-semibold">{job.title}</h1>
        <p className="text-muted-foreground">{job.company} · {countryLabel(job.country)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusBadge status={app.status} />{app.method && <Badge variant="secondary">{app.method}</Badge>}{app.lifecycle !== "none" && <Badge>{app.lifecycle}</Badge>}
          <SourceBadge portal={job.portal} source={job.source} />{fit && <ScoreBadge score={fit.score} />}<ApplyTypeBadge type={job.apply_type} />
        </div>
        <nav className="mt-3 flex flex-wrap gap-3 text-sm" aria-label="Sections">
          <a className="font-medium underline" href="#regenerate">Write a new resume / apply again</a><a className="underline" href="#job">A. Job details</a><a className="underline" href="#documents">B. Resume and documents</a><a className="underline" href="#answers">C. Answers and submission</a>
          <Link className="underline" href={`/logs?app=${id}`}>Activity log</Link>
          {app.run_id && <Link className="underline" href={`/logs/runs/${app.run_id}`}>Run that prepared it</Link>}
        </nav>
      </div>

      {who && (
        <Card id="who">
          <CardHeader><CardTitle>Who applied, and how we know</CardTitle><CardDescription>Read from what was recorded at the time, never guessed.</CardDescription></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p className="font-medium">{who.headline}{who.at ? <span className="font-normal text-muted-foreground"> · {who.at}</span> : null}</p>
            <p className={who.proof.level === "confirmed" ? "text-green-700 dark:text-green-500" : "text-amber-600"}><b>{who.proof.level === "confirmed" ? "Confirmed by the employer: " : who.proof.level === "claimed" ? "Reported, not seen by this app: " : "Not verified: "}</b>{who.proof.text}</p>
            {who.page && <p>Page: <a className="underline" href={who.page} target="_blank" rel="noreferrer">{who.page}</a></p>}
            {who.proof.level !== "confirmed" && <div className="flex flex-wrap items-center gap-2"><span className="text-muted-foreground">Not sure it went through?</span><ActionButton variant="outline" endpoint={`/api/applications/${id}`} body={{ action: "reapply", confirmSubmitted: true }} confirm="Prepare a new version and apply again? Only do this if you are sure the first one did not go through." success="Back to pending approval: press Approve">Apply again</ActionButton></div>}
          </CardContent>
        </Card>
      )}

      {app.error && <Card className="border-destructive"><CardHeader><CardTitle className="text-destructive">Last error</CardTitle></CardHeader><CardContent className="text-sm">{app.error}{app.status === "failed" && <div className="mt-3"><ActionButton variant="outline" endpoint={`/api/applications/${id}`} body={{ action: "retry" }} success="Back in the queue">Return to queue</ActionButton></div>}</CardContent></Card>}

      {["needs_input", "failed"].includes(app.status) && (() => {
        const r = sub.kind === "record" ? sub.record : null;
        const formUrl = r?.final_url && /^https?:/.test(r.final_url) ? r.final_url : job.url;
        const answers = (app.answers as { question: string; answer: string }[]) ?? [];
        return (
          <Card id="finish">
            <CardHeader>
              <CardTitle>Finish this one yourself</CardTitle>
              <CardDescription>
                Employers do not keep a half-filled form, so there is no link to a form that is already part-filled: the link opens the form from the start.
                Everything the assistant already knew is listed here to paste in, and the resume and cover letter are ready to upload. Press &ldquo;I have submitted it&rdquo; when done.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild><a href={formUrl} target="_blank" rel="noreferrer">{r?.final_url && r.final_url !== job.url ? "Open the form where it stopped" : "Open the application form"}</a></Button>
                {r?.final_url && r.final_url !== job.url && <Button variant="outline" asChild><a href={job.url} target="_blank" rel="noreferrer">Open the original job link</a></Button>}
                {dl(resume?.storage_path, "Download resume")}{dl(cover?.storage_path, "Download cover letter")}
                <ActionButton variant="outline" endpoint={`/api/applications/${id}`} body={{ action: "mark_submitted" }} success="Marked as submitted">I have submitted it</ActionButton>
                <ActionButton variant="outline" endpoint={`/api/applications/${id}`} body={{ action: "skip" }} success="Skipped">Skip this job</ActionButton>
              </div>
              {app.error && <p><b>Why it stopped:</b> <span className="text-destructive">{app.error}</span></p>}
              {r && r.unanswered.length > 0 && <div><b>Still needed from you:</b><ul className="list-disc pl-5">{r.unanswered.map((u, i) => <li key={i}>{u}</li>)}</ul></div>}
              {r && r.fields.length > 0 && (
                <details><summary className="cursor-pointer font-medium">Already filled in ({r.fields.filter((f) => f.kind !== "file").length}): copy from here if the form is blank</summary>
                  <Table><TableBody>{r.fields.filter((f) => f.kind !== "file").map((f, i) => <TableRow key={i}><TableCell className="whitespace-normal font-medium">{f.label}</TableCell><TableCell className="whitespace-normal">{f.value}</TableCell></TableRow>)}</TableBody></Table>
                </details>
              )}
              {answers.length > 0 && (
                <details><summary className="cursor-pointer font-medium">Answers prepared for this job ({answers.length})</summary>
                  <Table><TableBody>{answers.map((a, i) => <TableRow key={i}><TableCell className="whitespace-normal font-medium">{a.question}</TableCell><TableCell className="whitespace-normal">{a.answer}</TableCell></TableRow>)}</TableBody></Table>
                </details>
              )}
              {app.screenshot_path && <details><summary className="cursor-pointer font-medium">What the page looked like when it stopped</summary><img src={`/api/files?path=${encodeURIComponent(app.screenshot_path)}`} alt="The employer's page where the assistant stopped" className="mt-2 max-h-[28rem] rounded-md border" /></details>}
            </CardContent>
          </Card>
        );
      })()}

      {["prepared", "needs_input", "failed"].includes(app.status) && (
        <Card>
          <CardHeader><CardTitle>What to do now</CardTitle><CardDescription>{route.detail}</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            {issues.length > 0 ? (
              <ActionButton variant="destructive" endpoint={`/api/applications/${id}`} body={{ action: "approve", override: true }} confirm="Approve despite unverified claims?" success="Approved">Approve with override</ActionButton>
            ) : (
              <ActionButton endpoint={`/api/applications/${id}`} body={{ action: "approve" }} success="Approved">{route.kind === "cloud" ? "Approve and apply" : route.kind === "assistant" ? "Approve (the assistant applies)" : route.kind === "email" ? "Approve and send the email" : "Approve (I will submit)"}</ActionButton>
            )}
            <ActionButton variant="outline" endpoint={`/api/applications/${id}`} body={{ action: "skip" }} success="Skipped">Skip</ActionButton>
            {issues.length > 0 && <span className="text-xs text-destructive">{issues.length} claim(s) could not be verified against your profile. Review them below, or write a new resume.</span>}
          </CardContent>
        </Card>
      )}
      {app.status === "assisted_pending" && (
        <Card>
          <CardHeader><CardTitle>What to do now</CardTitle><CardDescription>{route.detail}</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            {route.kind === "assistant" && <ActionButton endpoint="/api/assistant/run" success="Assistant asked to run">Apply with assistant</ActionButton>}
            <Button variant="outline" asChild><a href={job.url} target="_blank" rel="noreferrer">Open the application page</a></Button>
            <ActionButton variant="outline" endpoint={`/api/applications/${id}`} body={{ action: "mark_submitted" }} success="Marked as submitted">I have submitted it</ActionButton>
          </CardContent>
        </Card>
      )}

      <div id="regenerate" className="grid gap-4 scroll-mt-4">
        <ReapplyCard id={id} status={app.status} />
        <RegenerateCard id={id} status={app.status} />
      </div>

      <EmailCard id={id} status={app.status} draft={emailDraft as never} listed={listedEmails} />


      <Card>
        <CardHeader><CardTitle>Outcome</CardTitle><CardDescription>Update as employers respond.</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(["applied", "interview", "rejected", "offer", "withdrawn"] as const).map((l) => (
            <ActionButton key={l} size="sm" variant={app.lifecycle === l ? "default" : "outline"} endpoint={`/api/applications/${id}`} body={{ action: "lifecycle", lifecycle: l }} success={`Marked ${l}`}>{l}</ActionButton>
          ))}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------ A */}
      <section id="job" className="grid scroll-mt-4 gap-3">
        <Card>
          <CardHeader>
            <CardTitle>A. Job details</CardTitle>
            <CardDescription>{snap ? `As it was when this application was prepared (${fmtDateTime(snap.captured_at)}).` : "Prepared before snapshots existed, so this shows the job as it is now."}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {moved.length > 0 && <p className="rounded-md border border-amber-500 p-2 text-sm">The live posting has changed since ({moved.join(", ")}). This page keeps the version you applied to. <Link className="underline" href={`/jobs/${app.job_id}`}>See the current job</Link>.</p>}
            <Table><TableBody>
              <Row k="Posting"><Link2 href={job.url} /></Row>
              <Row k="Where it lives"><SourceBadge portal={job.portal} source={job.source} /> <span className="text-xs text-muted-foreground">found via {String(job.source ?? "unknown").split(":")[0]}</span></Row>
              {Array.isArray(live.seen_on) && live.seen_on.length > 0 && <Row k="Also listed on">{live.seen_on.map((p: string) => portalLabel(p)).join(", ")} <span className="text-xs text-muted-foreground">(same role, kept as one job)</span></Row>}
              <Row k="Location">{job.location ?? "-"} · {countryLabel(job.country)}</Row>
              <Row k="Salary">{job.salary_text ?? "not stated"}{job.salary_min != null && <span className="text-muted-foreground"> · {job.salary_currency} {Math.round(job.salary_min).toLocaleString()}{job.salary_max && job.salary_max !== job.salary_min ? ` to ${Math.round(job.salary_max).toLocaleString()}` : ""} a year{job.salary_estimated ? " (estimate by the job site)" : ""}</span>}</Row>
              <Row k="Posted">{job.posted_at ? fmtDate(job.posted_at) : "not stated"}</Row>
              <Row k="Discovered">{fmtDateTime(job.found_at)}</Row>
              <Row k="Matched">{job.decided_at ? fmtDateTime(job.decided_at) : "-"}{fit && <> · fit {fit.score}{fit.model ? ` (${fit.model})` : ""}</>}</Row>
              <Row k="Prepared">{fmtDateTime(app.created_at)}</Row>
              <Row k="Approved">{app.approved_at ? fmtDateTime(app.approved_at) : "not yet"}</Row>
              <Row k="Applied">{app.submitted_at ? `${fmtDateTime(app.submitted_at)} (${app.method})` : "not yet"}</Row>
              <Row k="Statuses">application: <b>{app.status}</b> · job: <b>{live.status}</b> · outcome: <b>{app.lifecycle}</b></Row>
            </TableBody></Table>
            {fit && (
              <div className="grid gap-2 text-sm">
                <p><b>Why it matched:</b> {fit.summary}</p>
                <div className="flex flex-wrap gap-1">{(fit.matchedSkills ?? []).map((s: string) => <Badge key={s} variant="secondary">{s}</Badge>)}{(fit.gaps ?? []).map((s: string) => <Badge key={s} variant="outline">gap: {s}</Badge>)}</div>
              </div>
            )}
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">Full job description</summary>
              <div className="mt-3 whitespace-pre-wrap text-sm">{job.description}</div>
            </details>
          </CardContent>
        </Card>
      </section>

      {/* ------------------------------------------------------------ B */}
      <section id="documents" className="grid scroll-mt-4 gap-3">
        <Card>
          <CardHeader>
            <CardTitle>B. Resume and documents</CardTitle>
            <CardDescription>The exact files for this application. They are never overwritten; a new attempt creates a new version.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {resume && <><b>Tailored resume v{resume.version}</b>{resume.verification?.ok ? <Badge variant="secondary">verified</Badge> : <Badge variant="destructive">{resume.verification?.issues?.length ?? "?"} issue(s)</Badge>}<span className="text-xs text-muted-foreground">{resume.model} · {fmtDateTime(resume.created_at)}</span>{resume.verification?.reuse && resume.verification.reuse.mode !== "fresh" && <Badge variant="outline" title="Built from a past verified resume to save model usage">{`${resume.verification.reuse.mode === "reused" ? "Reused" : "Adapted"} from ${resume.verification.reuse.from?.title} at ${resume.verification.reuse.from?.company} (${Math.round((resume.verification.reuse.from?.similarity ?? 0) * 100)}% similar, about ${resume.verification.reuse.tokensSavedEstimate} tokens saved)`}</Badge>}{dl(resume.storage_path, "Download DOCX")}</>}
              {resume?.verification?.fallback && <p className="w-full rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">This application uses your master resume unchanged, because no tailored resume could be written ({resume.verification.reason ?? "no model was available"}). Run Prepare again once a model is available to get a resume written for this job.</p>}
              {resume?.verification?.quality && (() => { const q = resume.verification.quality!; return <p className="w-full text-xs text-muted-foreground" title="Measured locally from the job description and your profile">Aimed at this job: <b>{q.score}/100</b> · {q.keywordCoverage}% of the job&apos;s key terms you can honestly claim are used · {q.bulletsRewritten} of {q.bulletsTotal} bullets reworded for this job · headline {q.headlineTailored ? "matched" : "not matched"} · summary {q.summaryTailored ? "written for this job" : "general"}{q.gaps.length ? ` · asked for but not in your profile (never added): ${q.gaps.slice(0, 8).join(", ")}` : ""}</p>; })()}
              {app.profile_snapshot && <Button asChild size="sm" variant="outline"><a href={`/api/applications/${id}/original`}>Download original resume</a></Button>}
            </div>
            {issues.length > 0 && <ul className="list-disc pl-5 text-sm text-destructive">{issues.map((i, k) => <li key={k}>{i.where}: {i.problem}</li>)}</ul>}
            {usingLiveProfile && <p className="text-xs text-muted-foreground">This application has no profile snapshot, so names and dates in the preview come from your current profile.</p>}
            {resume && !tailoredView && <p className="text-sm text-muted-foreground">The resume text is stored in an unexpected format, so it cannot be previewed here. The DOCX download is the exact file.</p>}
            {tailoredView && <details open><summary className="cursor-pointer text-sm font-medium">Tailored resume (as sent)</summary><div className="mt-2"><ResumePreview view={tailoredView} style={style} /></div></details>}
            {originalView
              ? <details><summary className="cursor-pointer text-sm font-medium">Original resume (your master profile when this was prepared)</summary><div className="mt-2"><ResumePreview view={originalView} /></div></details>
              : <p className="text-sm text-muted-foreground">The original resume was not captured for this application (it was prepared before snapshots existed).</p>}

            <div>
              <h3 className="mb-1 text-sm font-medium">Changes made for this job</h3>
              {resume?.diff && resume.diff.length > 0 ? (
                <>
                  <p className="mb-2 text-sm text-muted-foreground">{diff.changed} of {diff.total} bullet(s) were reworded; {diff.kept} kept exactly as in your profile. Every sentence is checked against your profile facts.</p>
                  <Table>
                    <TableHeader><TableRow><TableHead>Your profile said</TableHead><TableHead>Sent as</TableHead><TableHead className="w-24">Change</TableHead></TableRow></TableHeader>
                    <TableBody>{resume.diff.map((d, i) => (
                      <TableRow key={i}><TableCell className="whitespace-normal text-sm text-muted-foreground">{d.original.join(" / ") || "-"}</TableCell><TableCell className="whitespace-normal text-sm">{d.tailored}</TableCell><TableCell>{d.changed ? <Badge>reworded</Badge> : <Badge variant="outline">unchanged</Badge>}</TableCell></TableRow>
                    ))}</TableBody>
                  </Table>
                </>
              ) : <p className="text-sm text-muted-foreground">No change record is stored for this resume.</p>}
            </div>

            {cover && (
              <div>
                <div className="mb-1 flex flex-wrap items-center gap-2"><b>Cover letter v{cover.version}</b>{cover.verification?.ok ? <Badge variant="secondary">verified</Badge> : <Badge variant="destructive">{cover.verification?.issues?.length ?? "?"} issue(s)</Badge>}<span className="text-xs text-muted-foreground">{cover.model} · {fmtDateTime(cover.created_at)}</span>{dl(cover.storage_path, "Download DOCX")}</div>
                {coverParsed?.success ? <div className="whitespace-pre-wrap rounded-md border bg-card p-3 text-sm">{coverParsed.data.text}</div> : <p className="text-sm text-muted-foreground">The cover letter text cannot be shown; the DOCX download is the exact file.</p>}
              </div>
            )}
            {others.length > 0 && (
              <div>
                <h3 className="mb-1 text-sm font-medium">Other versions generated for this job</h3>
                <Table><TableBody>{others.map((d) => (
                  <TableRow key={d.id}><TableCell>{d.kind.replace("_", " ")} v{d.version}</TableCell><TableCell className="text-sm text-muted-foreground">{d.model} · {fmtDateTime(d.created_at)}</TableCell><TableCell>{dl(d.storage_path, "Download")}</TableCell></TableRow>
                ))}</TableBody></Table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ------------------------------------------------------------ C */}
      <section id="answers" className="grid scroll-mt-4 gap-3">
        <Card>
          <CardHeader><CardTitle>C. Answers and submission</CardTitle><CardDescription>What was prepared, and exactly what was sent.</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            <div>
              <h3 className="mb-1 text-sm font-medium">Answers prepared</h3>
              {(app.answers as any[]).length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
                <Table><TableBody>{(app.answers as any[]).map((a, i) => <TableRow key={i}><TableCell className="whitespace-normal font-medium">{a.question}</TableCell><TableCell className="whitespace-normal">{a.answer}</TableCell><TableCell><Badge variant="outline">{a.source}</Badge></TableCell></TableRow>)}</TableBody></Table>
              )}
            </div>

            <div>
              <h3 className="mb-1 text-sm font-medium">Submission record</h3>
              {sub.kind === "none" && <p className="text-sm text-muted-foreground">{sub.reason === "not_submitted" ? "Nothing has been submitted yet." : "This application finished before detailed submission records existed, so only the timeline below is available."}</p>}
              {sub.kind === "record" && (() => { const r = sub.record; return (
                <div className="grid gap-3">
                  <Table><TableBody>
                    <Row k="Method">{r.method === "automated" ? "Submitted automatically" : "Submitted by you"}</Row>
                    <Row k="Outcome"><b>{r.outcome.replace("_", " ")}</b></Row>
                    <Row k="Started">{fmtDateTime(r.started_at)}</Row>
                    <Row k="Finished">{fmtDateTime(r.finished_at)}</Row>
                    <Row k="Form opened"><Link2 href={r.target_url} /></Row>
                    {r.final_url && <Row k="Final page"><Link2 href={r.final_url} /></Row>}
                    {r.confirmation && <Row k="Employer's confirmation">&ldquo;{r.confirmation.text}&rdquo;</Row>}
                    {r.error && <Row k="Error"><span className="text-destructive">{r.error}</span></Row>}
                    {r.note && <Row k="Note">{r.note}</Row>}
                  </TableBody></Table>
                  {r.unanswered.length > 0 && <div className="text-sm"><b>Needed you:</b> <ul className="list-disc pl-5">{r.unanswered.map((u, i) => <li key={i}>{u}</li>)}</ul></div>}
                  {r.fields.length > 0 && (
                    <div><h4 className="mb-1 text-sm font-medium">Values entered ({r.fields.length})</h4>
                      <Table><TableHeader><TableRow><TableHead>Field</TableHead><TableHead>Value</TableHead><TableHead>From</TableHead></TableRow></TableHeader>
                        <TableBody>{r.fields.map((f, i) => <TableRow key={i}><TableCell className="whitespace-normal">{f.label}</TableCell><TableCell className="whitespace-normal">{f.value}</TableCell><TableCell><Badge variant="outline">{f.source === "profile" ? "profile" : f.source === "answers" ? "answer bank" : "upload"}</Badge></TableCell></TableRow>)}</TableBody></Table></div>
                  )}
                  {r.files.length > 0 && (
                    <div><h4 className="mb-1 text-sm font-medium">Files attached</h4>
                      <Table><TableHeader><TableRow><TableHead>Document</TableHead><TableHead>File</TableHead><TableHead>Size</TableHead><TableHead>SHA-256</TableHead></TableRow></TableHeader>
                        <TableBody>{r.files.map((f, i) => <TableRow key={i}><TableCell>{f.role.replace("_", " ")}</TableCell><TableCell>{f.storage_path ? <a className="underline" href={`/api/files?path=${encodeURIComponent(f.storage_path)}`}>{f.name}</a> : f.name}</TableCell><TableCell>{fmtBytes(f.bytes)}</TableCell><TableCell><code className="text-xs" title={f.sha256}>{shortHash(f.sha256)}</code></TableCell></TableRow>)}</TableBody></Table></div>
                  )}
                </div>
              ); })()}
            </div>

            {app.screenshot_path && (
              <div><h3 className="mb-1 text-sm font-medium">Screenshot</h3>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files?path=${encodeURIComponent(app.screenshot_path)}`} alt="Screenshot of the employer's page after submitting" className="max-h-[32rem] rounded-md border" /></div>
            )}

            <div>
              <h3 className="mb-1 text-sm font-medium">Timeline</h3>
              <ol className="grid gap-2 text-sm">
                {events.map((e) => (
                  <li key={e.id} className="flex flex-wrap gap-x-3"><span className="w-44 text-muted-foreground">{fmtDateTime(e.at)}</span><span className="font-medium">{String(e.kind).replace(/_/g, " ")}</span>
                    {Object.keys(e.detail ?? {}).length > 0 && <code className="break-all text-xs text-muted-foreground">{JSON.stringify(e.detail)}</code>}</li>
                ))}
                {events.length === 0 && <li className="text-muted-foreground">No events yet.</li>}
              </ol>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
