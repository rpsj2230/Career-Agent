import { ActionButton } from "@/components/app/action-button";
import { LocalModelCard } from "@/components/app/local-model-card";
import { getSetting } from "@/lib/settings";
import { ModelDialog, type ModelForm } from "@/components/app/model-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db, must } from "@/lib/db";
import { ensureDefaultModels } from "@/lib/llm/registry";
import { fmtDateTime } from "@/lib/time";
import { modelHealth, type Call } from "@/lib/llm/health";
import { groupByProvider, modelClass } from "@/lib/llm/classes";
import { ProviderKeys, type KeySlot } from "@/components/app/provider-keys";
import { baseEnv, MAX_KEYS, slotEnv, storedKeyLabels } from "@/lib/llm/keys";

export const dynamic = "force-dynamic";

type Row = ModelForm & { id: string };

export default async function ModelsPage() {
  await ensureDefaultModels();
  const rows = must<Row[]>(await db().from("model_configs").select("*").order("priority"), "load models");
  const stored = await storedKeyLabels();
  const hasStored = (r: Row) => stored.has(r.label) || (!!r.api_key_env && Array.from({ length: MAX_KEYS }, (_, i) => slotEnv(baseEnv(r.api_key_env as string), i + 1)).some((e) => stored.has(`env:${e}`)));
  const hasKey = (r: Row) => hasStored(r) || r.api_key_env === null || Array.from({ length: MAX_KEYS }, (_, i) => slotEnv(baseEnv(r.api_key_env as string), i + 1)).some((e) => !!process.env[e]);
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const usage = must<{ model_label: string; ok: boolean }[]>(await db().from("model_usage").select("model_label,ok").gte("created_at", since.toISOString()), "load usage");
  const history = must<{ model_label: string; ok: boolean; error: string | null; created_at: string }[]>(await db().from("model_usage").select("model_label,ok,error,created_at").order("created_at", { ascending: false }).limit(600), "load model history");
  const callsOf = (label: string): Call[] => history.filter((h) => h.model_label === label).slice(0, 20).map((h) => ({ ok: h.ok, error: h.error, at: h.created_at }));
  const recentErrors = must<{ model_label: string; error: string; created_at: string }[]>(
    await db().from("model_usage").select("model_label,error,created_at").eq("ok", false).order("created_at", { ascending: false }).limit(5), "load errors",
  );
  const stat = (label: string) => ({ ok: usage.filter((u) => u.model_label === label && u.ok).length, bad: usage.filter((u) => u.model_label === label && !u.ok).length });
  const localModel = await getSetting("local_model");
  const localTest = await getSetting("local_model_test");
  const anyUsable = rows.some((r) => r.enabled && hasKey(r));

  const renderRow = (r: Row) => {
                const keyed = hasKey(r);
                const s = stat(r.label);
                const h = modelHealth({ enabled: r.enabled, keyed, todayOk: s.ok, todayBad: s.bad, dailyCap: r.daily_cap, calls: callsOf(r.label) });
                const tone = h.status === "working" ? "bg-green-600 text-white" : h.status === "failing" || h.status === "unstable" || h.status === "limit" ? "bg-amber-500 text-white" : "";
                return (
                  <TableRow key={r.id} className={r.enabled ? "" : "opacity-50"}>
                    <TableCell>{r.priority}</TableCell>
                    <TableCell><div className="font-medium">{r.label} <Badge variant="outline" className="ml-1 align-middle text-[10px] capitalize">{modelClass(r)}</Badge></div><div className="text-xs text-muted-foreground">{r.provider} · {r.model}</div><div className="text-xs text-muted-foreground">for {r.tasks.join(", ")}</div></TableCell>
                    <TableCell>{hasStored(r) ? <Badge>key saved</Badge> : r.api_key_env === null ? <Badge variant="secondary">none needed</Badge> : keyed ? <Badge variant="secondary">{r.api_key_env} (env)</Badge> : <Badge variant="outline">no key yet</Badge>}</TableCell>
                    <TableCell className="max-w-xs whitespace-normal">
                      <Badge className={tone} variant={tone ? "default" : "outline"}>{h.label}</Badge>
                      {h.status !== "working" && <div className="mt-1 text-xs text-muted-foreground">{h.hint}</div>}
                    </TableCell>
                    <TableCell className="text-sm">{s.ok} succeeded{r.daily_cap ? ` (daily allowance ${r.daily_cap})` : ""}{s.bad > 0 && <span className="text-muted-foreground">, {s.bad} failed</span>}</TableCell>
                    <TableCell className="max-w-xs whitespace-normal text-xs text-muted-foreground">
                      {h.lastError && h.status !== "working" ? <details><summary className="cursor-pointer">Last error</summary><div className="mt-1 break-words">{h.lastError.slice(0, 300)}{h.lastOkAt ? ` · last worked ${fmtDateTime(h.lastOkAt)}` : ""}</div></details> : s.bad > 0 ? "some earlier errors" : "none"}
                    </TableCell>
                    <TableCell className="flex gap-2">
                      <ActionButton size="sm" variant="secondary" endpoint="/api/models/test" body={{ label: r.label }} disabled={!keyed}>Test</ActionButton>
                      <ModelDialog id={r.id} hasStoredKey={hasStored(r)} initial={{ ...r, notes: r.notes ?? "" }} />
                    </TableCell>
                  </TableRow>
                );
              };

  const head = <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Model</TableHead><TableHead>Key</TableHead><TableHead>Status</TableHead><TableHead>Calls today</TableHead><TableHead>Errors (see Logs)</TableHead><TableHead /></TableRow></TableHeader>;
  const providers = groupByProvider(rows, (r) => r.enabled && hasKey(r));

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">Models</h1><ModelDialog /></div>
      {!anyUsable && (
        <Card className="border-destructive"><CardHeader><CardTitle className="text-destructive">No usable model</CardTitle><CardDescription>Click Edit on a model below, paste its API key, then press Test. Scoring and tailoring cannot run until at least one model has a key.</CardDescription></CardHeader></Card>
      )}
      <LocalModelCard initial={localModel} test={localTest} />
      <Card>
        <CardHeader>
          <CardTitle>Models by provider</CardTitle>
          <CardDescription>One card per provider, so a key is pasted once and its health is seen in one place. Each model shows its size (strong, medium or small): strong ones write resumes first, small ones score. Lowest priority number is tried first; on rate limit, error or bad output the next model is used, and the local model (above) is last. Models without a key are folded under &quot;Not set up yet&quot;.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-xs">
          {providers.map((g) => {
            const ok = g.rows.filter((r) => r.enabled && hasKey(r));
            const worked = ok.reduce((n, r) => n + stat(r.label).ok, 0);
            return <a key={g.provider} href={`#p-${g.provider}`} className="rounded border px-2 py-1 hover:bg-muted"><b>{g.name}</b>: {ok.length}/{g.rows.length} ready{worked > 0 ? `, ${worked} calls today` : ""}</a>;
          })}
        </CardContent>
      </Card>
      {providers.map((g) => {
        const ready = g.rows.filter((r) => hasKey(r));
        const idle = g.rows.filter((r) => !hasKey(r));
        const bases = [...new Set(g.rows.map((r) => r.api_key_env).filter((e): e is string => !!e).map(baseEnv))].sort();
        const slots: KeySlot[] = bases.flatMap((base) => Array.from({ length: MAX_KEYS }, (_, i) => slotEnv(base, i + 1)).map((e) => ({ env: e, set: stored.has(`env:${e}`) || !!process.env[e] || (e === base && g.rows.some((r) => r.api_key_env === base && stored.has(r.label))) })));
        return (
          <Card key={g.provider} id={`p-${g.provider}`}>
            <CardHeader>
              <CardTitle>{g.name} <span className="text-sm font-normal text-muted-foreground">({ready.length} ready, {idle.length} not set up)</span></CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {slots.length > 0 && <ProviderKeys provider={g.name} slots={slots} />}
              {ready.length > 0 ? <Table>{head}<TableBody>{ready.map(renderRow)}</TableBody></Table> : <p className="text-sm text-muted-foreground">No model of this provider has a key yet.</p>}
              {idle.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-sm text-muted-foreground">Not set up yet ({idle.length}): paste a key to switch them on</summary>
                  <Table>{head}<TableBody>{idle.map(renderRow)}</TableBody></Table>
                </details>
              )}
            </CardContent>
          </Card>
        );
      })}
      {recentErrors.length > 0 && (
        <Card><CardHeader><CardTitle>Recent failures</CardTitle></CardHeader><CardContent className="grid gap-1 text-sm">
          {recentErrors.map((e, i) => <div key={i}><span className="font-medium">{e.model_label}</span> <span className="text-muted-foreground">{fmtDateTime(e.created_at)}</span>: {e.error}</div>)}
        </CardContent></Card>
      )}
    </div>
  );
}
