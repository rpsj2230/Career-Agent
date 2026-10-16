import Link from "next/link";
import { AddJob } from "@/components/app/add-job";
import { ActionButton } from "@/components/app/action-button";
import { ApplyTypeBadge, ScoreBadge, StatusBadge } from "@/components/app/badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listJobs, scoreOf } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const jobs = await listJobs(["queued", "prepared", "saved"]);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Review queue</h1>
        <div className="flex flex-wrap gap-2">
          <AddJob />
          <ActionButton variant="outline" method="GET" endpoint="/api/cron/score" success="Scoring batch finished">Score new jobs</ActionButton>
          <ActionButton method="GET" endpoint="/api/cron/discover" success="Discovery finished">Find jobs now</ActionButton>
        </div>
      </div>
      <Card>
        <CardHeader><CardTitle>{jobs.length} job{jobs.length === 1 ? "" : "s"} matched to your profile</CardTitle></CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing queued yet. Run discovery, or add a job you found yourself.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Fit</TableHead><TableHead>Role</TableHead><TableHead>Where</TableHead><TableHead>Apply path</TableHead><TableHead>Status</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell><ScoreBadge score={scoreOf(j)?.score} /></TableCell>
                    <TableCell className="max-w-sm">
                      <Link href={`/jobs/${j.id}`} className="font-medium hover:underline">{j.title}</Link>
                      <div className="text-xs text-muted-foreground">{j.company}</div>
                    </TableCell>
                    <TableCell className="text-sm">{j.location ?? j.country?.toUpperCase() ?? "-"}</TableCell>
                    <TableCell><ApplyTypeBadge type={j.apply_type} /></TableCell>
                    <TableCell><StatusBadge status={j.status} /></TableCell>
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
