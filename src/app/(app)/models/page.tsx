import { ActionButton } from "@/components/app/action-button";
import { LocalModelCard } from "@/components/app/local-model-card";
import { getSetting } from "@/lib/settings";
import { ModelDialog, type ModelForm } from "@/components/app/model-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db, must } from "@/lib/db";
import { storedKeyLabels } from "@/lib/llm/keys";
import { ensureDefaultModels } from "@/lib/llm/registry";
import { fmtDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

type Row = ModelForm & { id: string };

export default async function ModelsPage() {
  await ensureDefaultModels();
  const rows = must<Row[]>(await db().from("model_configs").select("*").order("priority"), "load models");
  const stored = await storedKeyLabels();
  const hasKey = (r: Row) => stored.has(r.label) || r.api_key_env === null || !!process.env[r.api_key_env];
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const usage = must<{ model_label: string; ok: boolean }[]>(await db().from("model_usage").select("model_label,ok").gte("created_at", since.toISOString()), "load usage");
  const recentErrors = must<{ model_label: string; error: string; created_at: string }[]>(
    await db().from("model_usage").select("model_label,error,created_at").eq("ok", false).order("created_at", { ascending: false }).limit(5), "load errors",
  );
  const stat = (label: string) => ({ ok: usage.filter((u) => u.model_label === label && u.ok).length, bad: usage.filter((u) => u.model_label === label && !u.ok).length });
  const localModel = await getSetting("local_model");
  const anyUsable = rows.some((r) => r.enabled && hasKey(r));

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">Models</h1><ModelDialog /></div>
      {!anyUsable && (
        <Card className="border-destructive"><CardHeader><CardTitle className="text-destructive">No usable model</CardTitle><CardDescription>Click Edit on a model below, paste its API key, then press Test. Scoring and tailoring cannot run until at least one model has a key.</CardDescription></CardHeader></Card>
      )}
      <LocalModelCard initial={localModel} />
      <Card>
        <CardHeader>
          <CardTitle>Fallback chain</CardTitle>
          <CardDescription>Lowest priority number is tried first; on rate limit, error or bad output the next model is used, and the local model (above) is last. Models without a key set are skipped. Free-tier model ids and limits change often: edit them here when a provider renames or retires one.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Model</TableHead><TableHead>Key</TableHead><TableHead>Today</TableHead><TableHead>Tasks</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => {
                const keyed = hasKey(r);
                const s = stat(r.label);
                return (
                  <TableRow key={r.id} className={r.enabled ? "" : "opacity-50"}>
                    <TableCell>{r.priority}</TableCell>
                    <TableCell><div className="font-medium">{r.label}</div><div className="text-xs text-muted-foreground">{r.provider} · {r.model}</div></TableCell>
                    <TableCell>{stored.has(r.label) ? <Badge>key saved</Badge> : r.api_key_env === null ? <Badge variant="secondary">none needed</Badge> : keyed ? <Badge variant="secondary">{r.api_key_env} (env)</Badge> : <Badge variant="outline">no key yet</Badge>}</TableCell>
                    <TableCell className="text-sm">{s.ok}{r.daily_cap ? ` / ${r.daily_cap}` : ""} ok{s.bad > 0 && <span className="text-destructive">, {s.bad} failed</span>}</TableCell>
                    <TableCell className="text-xs">{r.tasks.join(", ")}</TableCell>
                    <TableCell className="flex gap-2">
                      <ActionButton size="sm" variant="secondary" endpoint="/api/models/test" body={{ label: r.label }} disabled={!keyed}>Test</ActionButton>
                      <ModelDialog id={r.id} hasStoredKey={stored.has(r.label)} initial={{ ...r, notes: r.notes ?? "" }} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {recentErrors.length > 0 && (
        <Card><CardHeader><CardTitle>Recent failures</CardTitle></CardHeader><CardContent className="grid gap-1 text-sm">
          {recentErrors.map((e, i) => <div key={i}><span className="font-medium">{e.model_label}</span> <span className="text-muted-foreground">{fmtDateTime(e.created_at)}</span>: {e.error}</div>)}
        </CardContent></Card>
      )}
    </div>
  );
}
