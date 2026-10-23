"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { call } from "./api";
import type { TodoItem } from "@/lib/todo";

/** The checklist: each tick is saved at once, so it is the same on every device. */
export function TodoList({ items, done: initial }: { items: TodoItem[]; done: Record<string, boolean> }) {
  const [done, setDone] = useState(initial);
  async function toggle(id: string, v: boolean) {
    const next = { ...done, [id]: v };
    setDone(next);
    if (!(await call("/api/settings", "PUT", { key: "todo_done", value: next }))) setDone(done);
  }
  return (
    <div className="grid gap-3">
      {items.map((t, i) => (
        <Card key={t.id} className={done[t.id] ? "opacity-60" : undefined}>
          <CardHeader className="flex-row items-start gap-3">
            <Checkbox id={t.id} checked={!!done[t.id]} onCheckedChange={(v) => toggle(t.id, v === true)} className="mt-1" />
            <div className="grid gap-1">
              <CardTitle className="text-base"><label htmlFor={t.id}>{i + 1}. {t.title}</label> {t.optional && <Badge variant="secondary">optional</Badge>} {t.decision && <Badge variant="outline">your decision</Badge>}</CardTitle>
              <CardDescription>{t.detail}</CardDescription>
            </div>
          </CardHeader>
          {(t.command || t.href) && (
            <CardContent className="grid gap-2 pt-0">
              {t.command && <code className="block overflow-x-auto rounded-md bg-muted p-2 text-xs">{t.command}</code>}
              {t.href && <Link className="text-sm underline" href={t.href}>{t.hrefLabel ?? "Open"}</Link>}
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}
