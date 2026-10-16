import { CopyButton } from "@/components/app/copy-button";
import { RecheckButton } from "@/components/app/recheck-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { MIGRATIONS } from "@/lib/migrations";
import { checkSchema, REQUIRED_SCHEMA } from "@/lib/schema";

export const dynamic = "force-dynamic";

const ENV: { name: string; purpose: string; required: boolean; ok: (v: string | undefined) => boolean }[] = [
  { name: "SUPABASE_URL", purpose: "Database", required: true, ok: (v) => !!v },
  { name: "SUPABASE_SERVICE_ROLE_KEY", purpose: "Database access and encryption of saved keys", required: true, ok: (v) => !!v },
  { name: "CRON_SECRET", purpose: "Scheduled runs and the invite code for your account (16+ characters)", required: true, ok: (v) => (v?.length ?? 0) >= 16 },
  { name: "GITHUB_REPO", purpose: "Starts the apply worker and pipeline (owner/repo)", required: false, ok: (v) => !!v },
  { name: "GITHUB_DISPATCH_TOKEN", purpose: "Token allowed to start GitHub Actions in this repository", required: false, ok: (v) => !!v },
  { name: "APP_URL", purpose: "Links in reports and notifications", required: false, ok: (v) => !!v },
  { name: "TELEGRAM_BOT_TOKEN", purpose: "Notifications", required: false, ok: (v) => !!v },
  { name: "TELEGRAM_CHAT_ID", purpose: "Notifications", required: false, ok: (v) => !!v },
];

export default async function SystemPage({ searchParams }: { searchParams: Promise<{ fresh?: string }> }) {
  const sp = await searchParams;
  const status = await checkSchema(sp.fresh === "1");
  const pending = MIGRATIONS.filter((m) => status.pendingMigrations.includes(m.id));
  const tables = [...new Set(REQUIRED_SCHEMA.map((r) => r.table))];
  const missingTables = new Set(status.problems.filter((p) => p.kind === "table").map((p) => p.table));
  const missingCols = status.problems.filter((p) => p.kind === "column");

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">System</h1>
        <RecheckButton />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Database {status.ok ? <Badge>up to date</Badge> : <Badge variant="destructive">{status.unreachable ? "check failed" : "update needed"}</Badge>}</CardTitle>
          <CardDescription>Checked {new Date(status.checkedAt).toLocaleString("en-IN")}. {status.unreachable ? `Problem: ${status.unreachable}` : status.ok ? "Every table and column the app needs exists." : "Some tables or columns are missing."}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {pending.length > 0 && (
            <div className="grid gap-3">
              <ol className="list-decimal pl-5 text-sm">
                <li>Click <b>Copy SQL</b> for each update below, in order.</li>
                <li>Open Supabase, then <b>SQL Editor</b>, then <b>New query</b>, paste, and click <b>Run</b>. It is safe to run more than once.</li>
                <li>Come back here and click <b>Re-check now</b>.</li>
              </ol>
              {pending.map((m) => (
                <div key={m.id} className="grid gap-2 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2"><span className="font-medium">{m.id}</span><CopyButton text={m.sql} label="Copy SQL" /></div>
                  <pre className="max-h-56 overflow-auto rounded bg-muted p-2 text-xs">{m.sql}</pre>
                </div>
              ))}
            </div>
          )}
          <Table>
            <TableBody>
              {tables.map((t) => {
                const cols = missingCols.filter((c) => c.table === t).map((c) => c.column);
                const bad = missingTables.has(t) || cols.length > 0;
                return (
                  <TableRow key={t}>
                    <TableCell className="font-mono text-sm">{t}</TableCell>
                    <TableCell>{bad ? <Badge variant="destructive">{missingTables.has(t) ? "missing" : `missing columns: ${cols.join(", ")}`}</Badge> : <Badge variant="secondary">ok</Badge>}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Configuration</CardTitle><CardDescription>Environment settings on the server. Values are never shown. Required items must be set for the app to work; the rest enable optional features.</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              {ENV.map((e) => {
                const ok = e.ok(process.env[e.name]);
                return (
                  <TableRow key={e.name}>
                    <TableCell className="font-mono text-sm">{e.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.purpose}</TableCell>
                    <TableCell>{ok ? <Badge>set</Badge> : e.required ? <Badge variant="destructive">missing (required)</Badge> : <Badge variant="outline">not set (optional)</Badge>}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
