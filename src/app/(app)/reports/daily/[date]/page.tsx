import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SECTION_TITLE, validDate } from "@/lib/daily-report";
import { getReport } from "@/lib/daily-report-store";
import { fmtDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function DailyReportPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!validDate(date)) notFound();
  const r = await getReport(date);
  if (!r) notFound();
  const sections = Object.keys(SECTION_TITLE).filter((k) => r.items.some((i) => i.section === k));
  const s = r.summary;
  return (
    <div className="grid gap-4">
      <div>
        <Link href="/reports" className="text-sm text-muted-foreground hover:underline">All reports</Link>
        <h1 className="text-2xl font-semibold">Daily report: {r.report_date}</h1>
        <p className="text-sm text-muted-foreground">{r.timezone} · generated {fmtDateTime(r.generated_at)} · {r.delivered ? "sent to Telegram" : "not sent to Telegram"}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {([["Found", s.found], ["Matched", s.matched], ["Rejected", s.rejected], ["Prepared", s.prepared], ["Submitted", s.submitted], ["Waiting for approval", s.awaiting], ["Need you to submit", s.manual], ["Failed", s.failed], ["Source problems", s.problems]] as const).map(([label, n]) => (
          <Card key={label}><CardHeader className="pb-1"><CardDescription>{label}</CardDescription><CardTitle className="text-3xl">{n}</CardTitle></CardHeader></Card>
        ))}
      </div>
      {sections.length === 0 && <p className="text-sm text-muted-foreground">Nothing happened on this day, and nothing needs attention.</p>}
      {sections.map((k) => {
        const items = r.items.filter((i) => i.section === k);
        return (
          <Card key={k} id={k} className={k === "failed" || k === "problems" ? "border-destructive" : ""}>
            <CardHeader><CardTitle className="text-base">{SECTION_TITLE[k]} <Badge variant="outline">{items.length}</Badge></CardTitle></CardHeader>
            <CardContent><ul className="grid gap-2 text-sm">
              {items.map((i, n) => (
                <li key={n}><Link className="font-medium underline" href={i.href}>{i.label}</Link>{i.detail && <span className="text-muted-foreground"> · {i.detail}</span>}</li>
              ))}
            </ul></CardContent>
          </Card>
        );
      })}
      <details className="rounded-md border p-3"><summary className="cursor-pointer text-sm font-medium">Message as sent to Telegram</summary><pre className="mt-2 whitespace-pre-wrap text-xs">{r.body}</pre></details>
    </div>
  );
}
