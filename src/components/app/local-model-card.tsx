"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { LOCAL_MODELS, type LocalModelSetting } from "@/lib/local-model";
import { ActionButton } from "./action-button";
import { call } from "./api";

const selectClass = "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
const MODES: { value: LocalModelSetting["mode"]; label: string; help: string }[] = [
  { value: "when_needed", label: "Only when the hosted models are failing (recommended)", help: "Normal runs stay fast. If no hosted model has a key, or most calls are failing, the next run starts the local model so no job is left unscored." },
  { value: "always", label: "Always have it ready", help: "Every run downloads and starts it (a few extra minutes), so it is there even for sudden failures." },
  { value: "off", label: "Off", help: "If every hosted model fails, jobs are queued on the free rules alone (marked 'rules only') and a model re-checks them later." },
];

/** The last-resort model. It runs for free on GitHub's computer during the scheduled run, not on yours, and not on the website. */
export type LocalTest = { at: string; ok: boolean; model: string; ms: number; note: string; run_url: string };

export function LocalModelCard({ initial, test }: { initial: LocalModelSetting; test?: LocalTest }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Local model: last fallback</CardTitle>
        <CardDescription>
          If a model fails, the next one in the chain below is tried, and a local model (Ollama) is tried last. It runs <b>on GitHub&apos;s free computer during the scheduled run</b>, not on your laptop and not on the website,
          so there is nothing to install or switch on yourself, and no key. It is slow, but it means a failing provider never makes you lose a job. The chain below shows <i>ollama-local</i> as runner-only for this reason; the Test button cannot reach it from the website.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-2">
          {MODES.map((m) => (
            <label key={m.value} className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm">
              <input type="radio" name="local-mode" checked={s.mode === m.value} onChange={() => setS({ ...s, mode: m.value })} className="mt-1" />
              <span><b>{m.label}</b><br /><span className="text-xs text-muted-foreground">{m.help}</span></span>
            </label>
          ))}
        </div>
        <div className="grid gap-1 md:max-w-md">
          <Label htmlFor="local-model">Model</Label>
          <select id="local-model" value={s.model} onChange={(e) => setS({ ...s, model: e.target.value })} className={selectClass} disabled={s.mode === "off"}>
            {(LOCAL_MODELS.some((m) => m.id === s.model) ? LOCAL_MODELS : [...LOCAL_MODELS, { id: s.model, label: s.model }]).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={async () => { if (await call("/api/settings", "PUT", { key: "local_model", value: s }, "Saved")) router.refresh(); }}>Save</Button>
          <ActionButton endpoint="/api/run/localtest" success="Test started">Test the local model now</ActionButton>
          <span className="text-xs text-muted-foreground">Runs on GitHub (3 to 6 minutes): installs the model, asks it a real scoring question, and records the answer here.</span>
        </div>
        <p className={`rounded-md border p-2 text-sm ${test?.at ? (test.ok ? "border-green-300 bg-green-50 text-green-900" : "border-red-300 bg-red-50 text-red-900") : "text-muted-foreground"}`}>
          {test?.at
            ? <>Last test {new Date(test.at).toLocaleString()}: <b>{test.ok ? "worked" : "FAILED"}</b> ({test.model}, {Math.round(test.ms / 1000)} s). {test.note}{test.run_url ? <> <a className="underline" href={test.run_url} target="_blank" rel="noreferrer">Run log</a></> : null}</>
            : "Not tested yet. Press the button to check that the local model really works."}
        </p>
      </CardContent>
    </Card>
  );
}
