"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionButton } from "./action-button";
import { SETUP_GUIDE_URL } from "@/lib/apply/assistant-request";
import type { Live, Recent } from "@/lib/apply/assistant-live";

const MARK = { submitted: "Sent", handed_back: "Needs you", left: "Waiting" } as const;
const ago = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000)); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

export function AssistantPanel({ online, pending, text, live, recent }: { online: boolean; pending: boolean; text: string; live?: Live | null; recent?: Recent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">Apply assistant on your computer <Badge className={online ? "bg-green-600 text-white" : ""} variant={online ? "default" : "secondary"}>{online ? "running" : "not running"}</Badge></CardTitle>
        <CardDescription>{text}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {live && <p className="rounded-md border border-green-600/40 p-2 text-sm"><b>Working on it now:</b> {live.title} at {live.company} ({live.portal}): {live.step}. <span className="text-muted-foreground">Started {ago(live.since)}.</span></p>}
        {recent && recent.length > 0 && (
          <div className="text-sm"><b>Latest results</b>
            <ul className="mt-1 grid gap-1">{recent.map((r, i) => <li key={i} className="flex flex-wrap gap-x-2"><Badge variant={r.outcome === "submitted" ? "default" : "secondary"} className={r.outcome === "submitted" ? "bg-green-600 text-white" : ""}>{MARK[r.outcome]}</Badge><span>{r.title} at {r.company}</span><span className="text-muted-foreground">{ago(r.at)}{r.note ? ` · ${r.note}` : ""}</span></li>)}</ul>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
        <ActionButton endpoint="/api/assistant/run" success="Requested" disabled={pending}>{pending ? (online ? "Requested: starting" : "Requested: waiting for the assistant to start") : "Ask the assistant to run now"}</ActionButton>
        <span className="text-xs text-muted-foreground">
          {online ? "The assistant is running; the button makes it start a round immediately instead of waiting for its next check." : <>This button only leaves a request; it cannot start anything on your computer. To get the assistant running: <a className="underline" href={SETUP_GUIDE_URL} target="_blank" rel="noreferrer">open the step-by-step setup guide</a>, then run <code>npm run assist:check</code> in the project folder to see what is missing.</>}
        </span>
        </div>
      </CardContent>
    </Card>
  );
}
