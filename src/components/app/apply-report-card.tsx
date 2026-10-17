import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ApplyReport, ApplyRow } from "@/lib/run-report";

function Rows({ title, rows }: { title: string; rows: ApplyRow[] }) {
  if (!rows.length) return null;
  return (
    <Table>
      <TableHeader><TableRow><TableHead>{title}</TableHead><TableHead>Submitted</TableHead><TableHead>Needs you</TableHead><TableHead>Failed</TableHead></TableRow></TableHeader>
      <TableBody>{rows.map((r) => <TableRow key={r.key}><TableCell className="font-medium">{r.key}</TableCell><TableCell>{r.submitted}</TableCell><TableCell>{r.needsYou}</TableCell><TableCell className={r.failed ? "text-destructive" : ""}>{r.failed}</TableCell></TableRow>)}</TableBody>
    </Table>
  );
}

export function ApplyReportCard({ report, title, description }: { report: ApplyReport; title: string; description: string }) {
  const empty = !report.submitted && !report.needsYou && !report.failed && !report.byScheduleApproved && !report.byYouApproved;
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
      <CardContent className="grid gap-4">
        {empty ? <p className="text-sm text-muted-foreground">No applying activity in this period.</p> : (
          <>
            <p className="text-sm">
              <strong>{report.submitted}</strong> submitted ({report.byMethod.automated} automatically, {report.byMethod.assisted} with you). Approved: <strong>{report.byScheduleApproved}</strong> automatically by a schedule, <strong>{report.byYouApproved}</strong> by you.
              {" "}{report.needsYou} handed back to you, {report.failed} failed.
            </p>
            <div className="grid gap-4 md:grid-cols-2"><Rows title="Portal" rows={report.byPortal} /><Rows title="Country" rows={report.byCountry} /></div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
