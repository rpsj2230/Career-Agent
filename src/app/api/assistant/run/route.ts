import { NextResponse } from "next/server";
import { requestAssistantRun } from "@/lib/apply/assistant-run";

/** Ask the apply assistant on your computer to start a round now (see requestAssistantRun). */
export async function POST() {
  const r = await requestAssistantRun("Asked the apply assistant on your computer to run now");
  return NextResponse.json(r.already ? { ok: true, already: true } : { ok: true });
}
