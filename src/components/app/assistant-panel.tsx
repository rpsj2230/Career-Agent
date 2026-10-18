"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionButton } from "./action-button";
import { SETUP_GUIDE_URL } from "@/lib/apply/assistant-request";

export function AssistantPanel({ online, pending, text }: { online: boolean; pending: boolean; text: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">Apply assistant on your computer <Badge className={online ? "bg-green-600 text-white" : ""} variant={online ? "default" : "secondary"}>{online ? "running" : "not running"}</Badge></CardTitle>
        <CardDescription>{text}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <ActionButton endpoint="/api/assistant/run" success="Requested" disabled={pending}>{pending ? (online ? "Requested: starting" : "Requested: waiting for the assistant to start") : "Ask the assistant to run now"}</ActionButton>
        <span className="text-xs text-muted-foreground">
          {online ? "The assistant is running; the button makes it start a round immediately instead of waiting for its next check." : <>This button only leaves a request; it cannot start anything on your computer. To get the assistant running: <a className="underline" href={SETUP_GUIDE_URL} target="_blank" rel="noreferrer">open the step-by-step setup guide</a>, then run <code>npm run assist:check</code> in the project folder to see what is missing.</>}
        </span>
      </CardContent>
    </Card>
  );
}
