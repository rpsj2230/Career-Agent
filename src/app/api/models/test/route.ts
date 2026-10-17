import { generateText, Output } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, must } from "@/lib/db";
import { isRunnerOnlyModel, type ModelRow } from "@/lib/llm/fallback";
import { resolveKeys } from "@/lib/llm/keys";
import { buildModel } from "@/lib/llm/registry";

export const maxDuration = 60;

/** Sends one tiny structured-output request to a single model, so you can verify its key and model id. */
export async function POST(request: Request) {
  const parsed = z.object({ label: z.string().min(1) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "label required" }, { status: 400 });
  const row = must<ModelRow | null>(await db().from("model_configs").select("*").eq("label", parsed.data.label).maybeSingle(), "find model");
  if (!row) return NextResponse.json({ error: "Unknown model" }, { status: 404 });
  if (isRunnerOnlyModel(row, process.env)) {
    return NextResponse.json({ ok: true, note: `${row.label} cannot be tested from the website. It runs on the scheduled GitHub runner, which starts its own copy of Ollama only when the hosted models have all failed. Nothing is wrong; you do not need to set anything up for it.` });
  }
  const key = (await resolveKeys([row])).get(row.label);
  if (!key && row.api_key_env !== null) return NextResponse.json({ error: `No key yet for ${row.label}. Paste one in Edit.` }, { status: 422 });

  const t0 = Date.now();
  try {
    const res = await generateText({
      model: buildModel(row, key),
      system: 'Reply only with JSON of the form {"answer": "<text>"}.',
      prompt: "What is 2 + 2? Put the number in answer.",
      output: Output.object({ schema: z.object({ answer: z.string() }) }),
      temperature: 0,
    });
    return NextResponse.json({ ok: true, note: `${row.label} works: answered "${res.output.answer}" in ${Date.now() - t0} ms` });
  } catch (e) {
    return NextResponse.json({ error: `${row.label} failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}` }, { status: 422 });
  }
}
