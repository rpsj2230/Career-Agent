import Link from "next/link";
import { StatusBadge } from "@/components/app/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db, must } from "@/lib/db";

export const dynamic = "force-dynamic";

type Row = {
  id: string; status: string; method: string | null; lifecycle: string; submitted_at: string | null; created_at: string;
  job: { title: string; company: string; country: string | null; apply_type: string } | null;
  resume: { version: number } | null;
};

export default async function ApplicationsPage() {
  const rows = must<Row[]>(
    await db().from("applications").select("id,status,method,lifecycle,submitted_at,created_at, job:jobs(title,company,country,apply_type), resume:documents!applications_resume_doc_id_fkey(version)").order("created_at", { ascending: false }).limit(300),
    "list applications",
  );
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "-");
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Applications</h1>
        <Button variant="outline" asChild><a href="/api/export/applications">Export CSV</a></Button>
      </div>
      <Card>
        <CardHeader><CardTitle>{rows.length} application{rows.length === 1 ? "" : "s"}</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing prepared yet. Open a job from the review queue and prepare it.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead>Method</TableHead><TableHead>Outcome</TableHead><TableHead>Resume</TableHead><TableHead>Submitted</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><Link className="font-medium hover:underline" href={`/applications/${r.id}`}>{r.job?.title}</Link><div className="text-xs text-muted-foreground">{r.job?.company} · {r.job?.country?.toUpperCase() ?? "-"}</div></TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell>{r.method ? <Badge variant="secondary">{r.method}</Badge> : "-"}</TableCell>
                    <TableCell>{r.lifecycle === "none" ? "-" : <Badge>{r.lifecycle}</Badge>}</TableCell>
                    <TableCell>v{r.resume?.version ?? "?"}</TableCell>
                    <TableCell className="text-sm">{fmt(r.submitted_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
