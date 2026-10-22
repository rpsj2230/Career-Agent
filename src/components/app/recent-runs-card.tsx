import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RunsTable } from "@/components/app/runs-table";
import { recentPipelineRuns } from "@/lib/run-queries";

/** The latest runs of every schedule and of the hourly backlog rounds, in one table. Each row opens that run's full detail. */
export async function RecentRunsCard() {
  const runs = await recentPipelineRuns(20);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Run history</CardTitle>
        <CardDescription>
          Every time something ran, newest first: your schedules above, and the hourly check that works through the backlog in between. For each: what it found, scored, matched, prepared and approved, how long it took and what went wrong. Open <b>Details</b> for the full story of one run (sources, AI models, jobs, applications, errors).
          {" "}<Link className="underline" href="/logs/runs">All runs and scans</Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto"><RunsTable runs={runs} /></CardContent>
    </Card>
  );
}
