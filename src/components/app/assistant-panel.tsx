"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionButton } from "./action-button";

export function AssistantPanel({ online, pending, text }: { online: boolean; pending: boolean; text: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">Apply assistant on your computer <Badge className={online ? "bg-green-600 text-white" : ""} variant={online ? "default" : "secondary"}>{online ? "running" : "not running"}</Badge></CardTitle>
        <CardDescription>{text}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <ActionButton endpoint="/api/assistant/run" success="Requested" disabled={pending}>{pending ? "Run requested" : "Run assistant now"}</ActionButton>
        <span className="text-xs text-muted-foreground">A web page cannot start a program on your computer, so the assistant must be running there (it can start by itself when you sign in: see docs/ASSISTANT_AUTOSTART.md). This button then makes it start a round immediately instead of waiting for its next check.</span>
      </CardContent>
    </Card>
  );
}
