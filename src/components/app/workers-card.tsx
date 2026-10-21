import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadWorkers } from "@/lib/workers-store";
import { WorkersControls } from "./workers-controls";

const STATE = {
  working: { label: "reporting in", cls: "bg-green-600 text-white" },
  quiet: { label: "quiet", cls: "bg-amber-500 text-white" },
  never: { label: "not set up", cls: "" },
  off: { label: "switched off", cls: "" },
} as const;

/** Who applies for you, whether each worker is alive, what each one handles, and the choices that route work between them. */
export async function WorkersCard() {
  const { rows, cloud } = await loadWorkers();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Workers: who applies, and who takes over</CardTitle>
        <CardDescription>Each application is taken by exactly one worker. They back each other up: if one does not take it, is down, or meets a sign-in page or security check, the next one does. Last 24 hours shown on the right.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3">
          {rows.map((w) => (
            <div key={w.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <b>{w.name}</b>
                <Badge className={STATE[w.state].cls} variant={w.state === "working" ? "default" : "secondary"}>{STATE[w.state].label}</Badge>
                <span className="text-muted-foreground">{w.seen}</span>
                <span className="ml-auto text-xs text-muted-foreground">started {w.started}{w.passedOn ? ` · passed on ${w.passedOn}` : ""}</span>
              </div>
              <div className="text-xs text-muted-foreground">{w.where}</div>
              <ul className="mt-1 list-disc pl-5">{w.handles.map((h) => <li key={h}>{h}</li>)}</ul>
            </div>
          ))}
        </div>
        <WorkersControls initial={cloud} />
        <p className="text-xs text-muted-foreground">Not changeable here: LinkedIn, Indeed and Naukri always need a worker that holds your sign-ins (your computer, or the always-on machine if you gave it your sign-ins). To keep a site for yourself, put its name in <code>ASSIST_SKIP</code> in <code>.env.local</code> on your computer. A worker that stays quiet for a few minutes (the always-on machine) or hours (GitHub) is replaced automatically by the next one.</p>
      </CardContent>
    </Card>
  );
}
