"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { COUNTRY_NAME_MAP } from "@/lib/countries";
import type { HandbackGroup } from "@/lib/apply/handbacks";
import { call } from "./api";

const selectClass = "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none";

/** Questions that stopped applications: answer once and every waiting application goes back to your queue with it filled in. */
export function HandbackAnswers({ groups }: { groups: HandbackGroup[] }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [scope, setScope] = useState<Record<string, string>>({});
  async function save(g: HandbackGroup) {
    const answer = (answers[g.key] ?? "").trim();
    if (!answer) return;
    const r = await call<{ requeued: number }>("/api/answers/learn", "POST", { question: g.question, answer, country: scope[g.key] || null, appIds: g.apps.map((a) => a.id) }, "Answer saved");
    if (r) router.refresh();
  }
  return (
    <div className="grid gap-3">
      {groups.map((g) => (
        <div key={g.key} className="grid gap-2 rounded-md border p-3 text-sm">
          <div><b>{g.question}</b> <span className="text-muted-foreground">stopped {g.count} application{g.count === 1 ? "" : "s"}: {g.apps.slice(0, 3).map((a) => `${a.title} at ${a.company}`).join("; ")}{g.apps.length > 3 ? ` and ${g.apps.length - 3} more` : ""}</span></div>
          <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
            <Input aria-label={`Answer to ${g.question}`} placeholder="Your answer" value={answers[g.key] ?? ""} onChange={(e) => setAnswers({ ...answers, [g.key]: e.target.value })} />
            <select aria-label="Applies to" className={selectClass} value={scope[g.key] ?? ""} onChange={(e) => setScope({ ...scope, [g.key]: e.target.value })}>
              <option value="">Every country</option>
              {g.countries.map((c) => <option key={c} value={c}>Only {COUNTRY_NAME_MAP[c] ?? c.toUpperCase()}</option>)}
            </select>
            <Button onClick={() => save(g)} disabled={!(answers[g.key] ?? "").trim()}>Save and send again</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
