import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { handbackReasons } from "@/lib/handback-store";

/** Why applications were not sent by the workers, in a few plain reasons, with what to do about each. */
export async function HandbackCard() {
  const r = await handbackReasons();
  if (!r) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Why applications were not sent</CardTitle>
        <CardDescription>
          {r.total === 0 ? "Nothing has been handed back to you." : <>{r.total.toLocaleString("en-US")} application{r.total === 1 ? " was" : "s were"} handed back to you by the workers. Each one shows its exact reason on its page. <Link className="underline" href="/applications?stage=needs_input">Open them</Link></>}
        </CardDescription>
      </CardHeader>
      {r.lines.length > 0 && (
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Reason</TableHead><TableHead className="text-right">Applications</TableHead><TableHead>Where</TableHead><TableHead>What to do</TableHead></TableRow></TableHeader>
            <TableBody>
              {r.lines.map((l) => (
                <TableRow key={l.id} className="align-top">
                  <TableCell className="max-w-xs whitespace-normal"><div className="font-medium">{l.title}</div><div className="text-xs text-muted-foreground">{l.why}</div></TableCell>
                  <TableCell className="text-right text-base font-semibold tabular-nums">{l.count.toLocaleString("en-US")}</TableCell>
                  <TableCell className="whitespace-normal text-xs">{l.portals.slice(0, 4).map((p) => `${p.portal} ${p.count}`).join(", ")}</TableCell>
                  <TableCell className="max-w-sm whitespace-normal text-sm text-muted-foreground">{l.action}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      )}
    </Card>
  );
}
