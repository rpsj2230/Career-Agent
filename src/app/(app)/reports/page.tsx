import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { CountrySelect } from "@/components/app/country-select";
import { countryLabel, parseCountry } from "@/lib/filters";
import { daysAgo, filterOptions, reportRows } from "@/lib/queries";
import { summarize, type Summary } from "@/lib/reports";

export const dynamic = "force-dynamic";

const List = ({ title, items }: { title: string; items: { name: string; count: number }[] }) => (
  <Card>
    <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
    <CardContent>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">No data yet</p> : (
        <Table><TableBody>{items.map((i) => <TableRow key={i.name}><TableCell>{i.name}</TableCell><TableCell className="text-right font-medium">{i.count}</TableCell></TableRow>)}</TableBody></Table>
      )}
    </CardContent>
  </Card>
);

function Block({ title, s }: { title: string; s: Summary }) {
  const stat = (label: string, v: string | number | null) => (
    <Card><CardHeader className="pb-1"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl">{v ?? "-"}</CardTitle></CardHeader></Card>
  );
  return (
    <section className="grid gap-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        {stat("Submitted", s.submitted)}{stat("Interviews/offers", s.responded)}{stat("Rejected", s.rejected)}
        {stat("Response rate", s.responseRate === null ? null : `${s.responseRate}%`)}{stat("Avg fit (sent)", s.avgFitSubmitted)}{stat("Avg fit (got reply)", s.avgFitResponded)}
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <List title="By country" items={s.byCountry} /><List title="By source" items={s.bySource} /><List title="By apply path" items={s.byType} /><List title="Most common skill gaps in JDs" items={s.commonGaps} />
      </div>
    </section>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const country = parseCountry(await searchParams);
  const [rows, opts] = await Promise.all([reportRows(country), filterOptions()]);
  const week = summarize(rows, daysAgo(7));
  const all = summarize(rows);
  return (
    <div className="grid gap-6">
      <div><h1 className="text-2xl font-semibold">Reports</h1><p className="text-sm text-muted-foreground">Response rate counts interviews and offers only; rejections are shown separately. Update outcomes on each application so these stay accurate.</p></div>
      <CountrySelect action="/reports" country={country} options={opts.countries} />
      {country && <p className="text-sm">Showing {countryLabel(country)} only.</p>}
      <Block title="Last 7 days" s={week} />
      <Block title="All time" s={all} />
    </div>
  );
}
