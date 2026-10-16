import { notFound } from "next/navigation";
import { ActionButton } from "@/components/app/action-button";
import { ApplyTypeBadge, ScoreBadge, StatusBadge } from "@/components/app/badges";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db, must } from "@/lib/db";
import type { JobScore, TailoredResume, CoverLetter } from "@/lib/types";

export const dynamic = "force-dynamic";

type Doc = {
  id: string; kind: string; version: number; content: unknown; diff: { experienceId: string; tailored: string; original: string[]; changed: boolean }[] | null;
  verification: { ok: boolean; attempts: number; issues: { where: string; problem: string }[] } | null; storage_path: string | null; model: string | null;
};

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = must<Record<string, any> | null>(await db().from("jobs").select("*, job_scores(score, detail, model)").eq("id", id).maybeSingle(), "load job"); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!job) notFound();
  const sc = Array.isArray(job.job_scores) ? job.job_scores[0] : job.job_scores;
  const detail = sc?.detail as JobScore | undefined;
  const app = must<Record<string, any> | null>(await db().from("applications").select("*").eq("job_id", id).maybeSingle(), "load application"); // eslint-disable-line @typescript-eslint/no-explicit-any
  const docs = app
    ? must<Doc[]>(await db().from("documents").select("*").in("id", [app.resume_doc_id, app.cover_doc_id].filter(Boolean)), "load docs")
    : [];
  const resume = docs.find((d) => d.kind === "resume");
  const cover = docs.find((d) => d.kind === "cover_letter");
  const issues = [...(resume?.verification?.issues ?? []), ...(cover?.verification?.issues ?? [])];
  const unverified = issues.length > 0;
  const pending = app && ["prepared", "needs_input", "failed"].includes(app.status);
  const auto = job.apply_type === "greenhouse" || job.apply_type === "lever";
  const tailored = resume?.content as TailoredResume | undefined;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{job.title}</h1>
          <p className="text-muted-foreground">{job.company} · {job.location ?? job.country?.toUpperCase() ?? "location n/a"} · {job.salary_text ?? "salary n/a"}</p>
          <div className="mt-2 flex flex-wrap gap-2"><ScoreBadge score={sc?.score} /><ApplyTypeBadge type={job.apply_type} /><StatusBadge status={job.status} /></div>
        </div>
        <Button variant="outline" asChild><a href={job.url} target="_blank" rel="noreferrer">Open posting</a></Button>
      </div>

      {detail && (
        <Card>
          <CardHeader><CardTitle>Why this score</CardTitle><CardDescription>{detail.summary}</CardDescription></CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-2">
            <div><div className="mb-1 font-medium">Matched</div><div className="flex flex-wrap gap-1">{detail.matchedSkills.map((s) => <Badge key={s} variant="secondary">{s}</Badge>)}</div></div>
            <div><div className="mb-1 font-medium">Gaps</div><div className="flex flex-wrap gap-1">{detail.gaps.length ? detail.gaps.map((s) => <Badge key={s} variant="outline">{s}</Badge>) : <span className="text-muted-foreground">None found</span>}</div></div>
            <div><span className="font-medium">Seniority:</span> {detail.seniorityFit}</div>
            <div><span className="font-medium">Location/visa:</span> {detail.locationVisaFit}</div>
            <div className="md:col-span-2"><span className="font-medium">Salary:</span> {detail.salarySignal}</div>
          </CardContent>
        </Card>
      )}

      {!app && (
        <Card>
          <CardHeader><CardTitle>Prepare application</CardTitle><CardDescription>Tailors your resume and cover letter from your verified profile facts. Takes up to a minute on free models.</CardDescription></CardHeader>
          <CardContent><ActionButton endpoint={`/api/jobs/${id}/prepare`} success="Application prepared">Prepare resume and cover letter</ActionButton></CardContent>
        </Card>
      )}

      {app && (
        <>
          {unverified ? (
            <Alert variant="destructive">
              <AlertTitle>Verification found claims that are not backed by your profile</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 list-disc pl-5">{issues.map((i, k) => <li key={k}><code>{i.where}</code>: {i.problem}</li>)}</ul>
                <p className="mt-1">Fix your profile or approve with override only if you have checked these yourself.</p>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert><AlertTitle>Verified</AlertTitle><AlertDescription>Every sentence maps to facts in your profile; no unsupported numbers.</AlertDescription></Alert>
          )}

          {pending && (
            <Card>
              <CardContent className="flex flex-wrap items-center gap-2 pt-6">
                {unverified ? (
                  <ActionButton variant="destructive" endpoint={`/api/applications/${app.id}`} body={{ action: "approve", override: true }} confirm="Approve despite unverified claims?" success="Approved">Approve with override</ActionButton>
                ) : (
                  <ActionButton endpoint={`/api/applications/${app.id}`} body={{ action: "approve" }} success="Approved">{auto ? "Approve and apply" : "Approve (assisted)"}</ActionButton>
                )}
                <ActionButton variant="outline" endpoint={`/api/applications/${app.id}`} body={{ action: "save" }} success="Saved for later">Save</ActionButton>
                <ActionButton variant="outline" endpoint={`/api/applications/${app.id}`} body={{ action: "skip" }} success="Skipped">Skip</ActionButton>
                <span className="text-xs text-muted-foreground">{auto ? "Submitted by the worker; you get a confirmation screenshot." : "You press the final submit on the employer site; mark it submitted afterwards."}</span>
              </CardContent>
            </Card>
          )}
          {app.status === "assisted_pending" && (
            <Card>
              <CardHeader><CardTitle>Ready for you to submit</CardTitle><CardDescription>Open the posting, upload the documents below, answer with the prepared answers, then confirm here.</CardDescription></CardHeader>
              <CardContent className="flex gap-2">
                <Button asChild><a href={job.url} target="_blank" rel="noreferrer">Open application page</a></Button>
                <ActionButton variant="outline" endpoint={`/api/applications/${app.id}`} body={{ action: "mark_submitted" }} success="Marked as submitted">I have submitted it</ActionButton>
              </CardContent>
            </Card>
          )}
          {app.status !== "prepared" && (
            <p className="text-sm text-muted-foreground">Application status: <StatusBadge status={app.status} /> · <a className="underline" href={`/applications/${app.id}`}>full audit trail</a></p>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Tailored resume</CardTitle>
              <CardDescription>
                {tailored?.headline} · model {resume?.model} · v{resume?.version}
                {resume?.storage_path && <> · <a className="underline" href={`/api/files?path=${encodeURIComponent(resume.storage_path)}`}>Download DOCX</a></>}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <p className="text-sm">{tailored?.summary.text}</p>
              <Table>
                <TableHeader><TableRow><TableHead className="w-1/2">Your original</TableHead><TableHead>Tailored</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(resume?.diff ?? []).map((d, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-normal align-top text-sm text-muted-foreground">{d.original.join(" / ")}</TableCell>
                      <TableCell className="whitespace-normal align-top text-sm">{d.tailored}{d.changed && <Badge variant="outline" className="ml-2">reworded</Badge>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cover letter</CardTitle>
              <CardDescription>{cover?.storage_path && <a className="underline" href={`/api/files?path=${encodeURIComponent(cover.storage_path)}`}>Download DOCX</a>}</CardDescription>
            </CardHeader>
            <CardContent><p className="whitespace-pre-wrap text-sm">{(cover?.content as CoverLetter | undefined)?.text}</p></CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Prepared answers</CardTitle><CardDescription>From your answer bank and profile. Edit them on the Profile page.</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  {(app.answers as { question: string; answer: string; source: string }[]).map((a, i) => (
                    <TableRow key={i}><TableCell className="font-medium">{a.question}</TableCell><TableCell>{a.answer}</TableCell><TableCell><Badge variant="outline">{a.source}</Badge></TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <details className="rounded-md border p-4">
        <summary className="cursor-pointer text-sm font-medium">Job description</summary>
        <p className="mt-3 whitespace-pre-wrap text-sm">{job.description}</p>
      </details>
    </div>
  );
}
