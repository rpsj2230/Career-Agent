import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadPipelineTable } from "@/lib/pipeline-table-store";

const num = (x: number | null, href?: string) => (x == null ? <span title="This number could not be read" className="text-muted-foreground">?</span> : href && x > 0 ? <Link className="underline decoration-dotted underline-offset-4" title="Show them" href={href}>{x.toLocaleString("en-US")}</Link> : x.toLocaleString("en-US"));

/** The whole pipeline in one table: what happened in the last 24 hours, what is waiting now, and the limit at each step. */
export async function PipelineTableCard() {
  const { rows, schedulesText } = await loadPipelineTable();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">The pipeline at a glance</CardTitle>
        <CardDescription>
          Six steps, in order. &quot;Last 24 hours&quot; is what was done in the past day by every run together. &quot;Waiting now&quot; is what is still queued for that step.
          Click a number to see the jobs or applications behind it. The numbers for one particular run are on that run&apos;s own page (Run history, below).
          {schedulesText.length ? ` ${schedulesText.join(" ")}` : " No schedule is switched on."} The app also checks every hour and works through any backlog between schedules.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Step</TableHead><TableHead className="text-right">Last 24 hours</TableHead><TableHead className="text-right">Waiting now</TableHead><TableHead>Limit that applies</TableHead><TableHead>Change it</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.step} className="align-top">
                <TableCell className="whitespace-normal"><div className="font-medium">{r.step}</div><div className="text-xs text-muted-foreground">{r.question}</div></TableCell>
                <TableCell className="text-right text-base font-semibold tabular-nums">{num(r.last24h, r.last24hHref)}</TableCell>
                <TableCell className="text-right text-base font-semibold tabular-nums">{r.waiting === undefined ? "-" : num(r.waiting, r.waitingHref)}</TableCell>
                <TableCell className="max-w-xl whitespace-normal text-sm text-muted-foreground">{r.limit}</TableCell>
                <TableCell className="whitespace-nowrap text-sm"><Link className="underline" href={r.link.href}>{r.link.label}</Link></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
