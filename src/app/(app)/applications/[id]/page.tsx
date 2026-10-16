import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/app/action-button";
import { StatusBadge } from "@/components/app/badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { db, must } from "@/lib/db";
import { fmtDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = must<any | null>(await db().from("applications").select("*, job:jobs(*)").eq("id", id).maybeSingle(), "load application");
  if (!app) notFound();
  const events = must<any[]>(await db().from("apply_events").select("*").eq("application_id", id).order("at", { ascending: true }), "load events");
  const docs = must<any[]>(await db().from("documents").select("id,kind,version,storage_path,model,created_at,verification").eq("job_id", app.job_id).order("created_at", { ascending: true }), "load docs");
  const fmt = (d: string | null) => fmtDateTime(d);

  return (
    <div className="grid gap-4">
      <div>
        <Link href="/applications" className="text-sm text-muted-foreground hover:underline">All applications</Link>
        <h1 className="text-2xl font-semibold">{app.job.title}</h1>
        <p className="text-muted-foreground">{app.job.company} · <Link className="underline" href={`/jobs/${app.job_id}`}>job and package</Link> · <a className="underline" href={app.job.url} target="_blank" rel="noreferrer">posting</a></p>
        <div className="mt-2 flex flex-wrap gap-2"><StatusBadge status={app.status} />{app.method && <Badge variant="secondary">{app.method}</Badge>}{app.lifecycle !== "none" && <Badge>{app.lifecycle}</Badge>}</div>
      </div>

      {app.error && <Card className="border-destructive"><CardHeader><CardTitle className="text-destructive">Last error</CardTitle></CardHeader><CardContent className="text-sm">{app.error}{app.status === "failed" && <div className="mt-3"><ActionButton variant="outline" endpoint={`/api/applications/${id}`} body={{ action: "retry" }} success="Back in the queue">Return to queue</ActionButton></div>}</CardContent></Card>}

      <Card>
        <CardHeader><CardTitle>Outcome</CardTitle><CardDescription>Update as employers respond.</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(["applied", "interview", "rejected", "offer", "withdrawn"] as const).map((l) => (
            <ActionButton key={l} size="sm" variant={app.lifecycle === l ? "default" : "outline"} endpoint={`/api/applications/${id}`} body={{ action: "lifecycle", lifecycle: l }} success={`Marked ${l}`}>{l}</ActionButton>
          ))}
        </CardContent>
      </Card>

      {app.screenshot_path && (
        <Card><CardHeader><CardTitle>Submission screenshot</CardTitle></CardHeader><CardContent>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/files?path=${encodeURIComponent(app.screenshot_path)}`} alt="Confirmation screenshot of the submitted application" className="max-h-[32rem] rounded-md border" />
        </CardContent></Card>
      )}

      <Card>
        <CardHeader><CardTitle>Documents sent</CardTitle><CardDescription>Every version generated for this job; the application used the one marked.</CardDescription></CardHeader>
        <CardContent>
          <Table><TableBody>
            {docs.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.kind.replace("_", " ")} v{d.version}{(d.id === app.resume_doc_id || d.id === app.cover_doc_id) && <Badge className="ml-2">used</Badge>}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{d.model} · {fmt(d.created_at)}</TableCell>
                <TableCell>{d.verification?.ok ? <Badge variant="secondary">verified</Badge> : <Badge variant="destructive">{d.verification?.issues?.length ?? "?"} issue(s)</Badge>}</TableCell>
                <TableCell>{d.storage_path && <a className="underline" href={`/api/files?path=${encodeURIComponent(d.storage_path)}`}>Download</a>}</TableCell>
              </TableRow>
            ))}
          </TableBody></Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Answers submitted</CardTitle></CardHeader>
        <CardContent><Table><TableBody>
          {(app.answers as any[]).map((a, i) => <TableRow key={i}><TableCell className="font-medium">{a.question}</TableCell><TableCell>{a.answer}</TableCell><TableCell><Badge variant="outline">{a.source}</Badge></TableCell></TableRow>)}
        </TableBody></Table></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
        <CardContent>
          <ol className="grid gap-2 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-3"><span className="w-44 text-muted-foreground">{fmt(e.at)}</span><span className="font-medium">{e.kind.replace(/_/g, " ")}</span>
                {Object.keys(e.detail ?? {}).length > 0 && <code className="break-all text-xs text-muted-foreground">{JSON.stringify(e.detail)}</code>}</li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
