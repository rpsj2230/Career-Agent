import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { backgroundStatus } from "@/lib/background-status";
import { ago } from "@/lib/automation-checks";
import { AutoRefresh } from "./auto-refresh";

const liveCounters = (st: Record<string, number>) => [["inserted", "new jobs found"], ["scored", "scored"], ["matched", "matched"], ["prepared", "resumes prepared"], ["auto_approved", "approved"]].filter(([k]) => st[k]).map(([k, label]) => `${st[k]} ${label}`).join(" · ");

const WHAT: Record<string, string> = { scan: "Searching for jobs", score: "Scoring jobs", prepare: "Preparing an application", pipeline: "The scheduled run", discover: "Searching and scoring", task: "A background task" };

/** Says what the background work is doing right now (or just did), and refreshes itself while it is working. */
export async function BackgroundBanner() {
  const s = await backgroundStatus();
  if (s.state === "idle") return null;
  const now = new Date();
  if (s.state === "starting") return (
    <Alert><Loader2 className="size-4 animate-spin" /><AlertTitle>Starting in the background</AlertTitle>
      <AlertDescription>{WHAT[s.task] ?? "A task"} was handed to GitHub {ago(s.since, now)}. It takes a minute to start and a few minutes to finish; this page updates by itself.<AutoRefresh active /></AlertDescription></Alert>
  );
  if (s.state === "running") return (
    <Alert><Loader2 className="size-4 animate-spin" /><AlertTitle>{WHAT[s.kind] ?? "Working"} in the background</AlertTitle>
      <AlertDescription>Started {ago(s.since, now)}. So far: {liveCounters(s.stats) || "starting up, nothing saved yet"}. New results appear here as they are saved; this page updates by itself. <Link className="underline" href="/logs/runs">See the run</Link>.<AutoRefresh active /></AlertDescription></Alert>
  );
  const nums = Object.entries(s.stats).filter(([k]) => ["inserted", "scored", "matched", "prepared", "fetched"].includes(k)).map(([k, v]) => `${v} ${k}`).join(" · ");
  return (
    <Alert variant={s.status === "failed" ? "destructive" : "default"}>
      <AlertTitle>{WHAT[s.kind] ?? "Last run"}: {s.status} {ago(s.at, now)}</AlertTitle>
      <AlertDescription>{nums || "No counters were recorded."}{s.error ? ` ${s.error}` : ""} <Link className="underline" href="/logs/runs">Details</Link></AlertDescription>
    </Alert>
  );
}
