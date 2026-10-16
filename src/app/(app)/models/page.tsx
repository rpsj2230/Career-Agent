import { ModelDialog, type ModelForm } from "@/components/app/model-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db, must } from "@/lib/db";

export const dynamic = "force-dynamic";

type Row = ModelForm & { id: string };

export default async function ModelsPage() {
  const rows = must<Row[]>(await db().from("model_configs").select("*").order("priority"), "load models");
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const usage = must<{ model_label: string; ok: boolean }[]>(await db().from("model_usage").select("model_label,ok").gte("created_at", since.toISOString()), "load usage");
  const recentErrors = must<{ model_label: string; error: string; created_at: string }[]>(
    await db().from("model_usage").select("model_label,error,created_at").eq("ok", false).order("created_at", { ascending: false }).limit(5), "load errors",
  );
  const stat = (label: string) => ({ ok: usage.filter((u) => u.model_label === label && u.ok).length, bad: usage.filter((u) => u.model_label === label && !u.ok).length });
  const anyUsable = rows.some((r) => r.enabled && (r.api_key_env === null || process.env[r.api_key_env]));

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">Models</h1><ModelDialog /></div>
      {!anyUsable && (
        <Card className="border-destructive"><CardHeader><CardTitle className="text-destructive">No usable model</CardTitle><CardDescription>Set at least one provider key in your environment (for example GEMINI_API_KEY or GROQ_API_KEY) and redeploy. Scoring and tailoring cannot run until you do.</CardDescription></CardHeader></Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Fallback chain</CardTitle>
          <CardDescription>Lowest priority number is tried first; on rate limit or bad output the next model is used. Models without a key set are skipped. Free-tier model ids and limits change often: edit them here when a provider renames or retires one.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Model</TableHead><TableHead>Key</TableHead><TableHead>Today</TableHead><TableHead>Tasks</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => {
                const keyed = r.api_key_env === null || !!process.env[r.api_key_env];
                const s = stat(r.label);
                return (
                  <TableRow key={r.id} className={r.enabled ? "" : "opacity-50"}>
                    <TableCell>{r.priority}</TableCell>
                    <TableCell><div className="font-medium">{r.label}</div><div className="text-xs text-muted-foreground">{r.provider} · {r.model}</div></TableCell>
                    <TableCell>{r.api_key_env === null ? <Badge variant="secondary">none needed</Badge> : keyed ? <Badge>{r.api_key_env} set</Badge> : <Badge variant="outline">{r.api_key_env} missing</Badge>}</TableCell>
                    <TableCell className="text-sm">{s.ok}{r.daily_cap ? ` / ${r.daily_cap}` : ""} ok{s.bad > 0 && <span className="text-destructive">, {s.bad} failed</span>}</TableCell>
                    <TableCell className="text-xs">{r.tasks.join(", ")}</TableCell>
                    <TableCell><ModelDialog id={r.id} initial={{ ...r, notes: r.notes ?? "" }} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {recentErrors.length > 0 && (
        <Card><CardHeader><CardTitle>Recent failures</CardTitle></CardHeader><CardContent className="grid gap-1 text-sm">
          {recentErrors.map((e, i) => <div key={i}><span className="font-medium">{e.model_label}</span> <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString("en-IN")}</span>: {e.error}</div>)}
        </CardContent></Card>
      )}
    </div>
  );
}
