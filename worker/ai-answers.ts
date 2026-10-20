import { runStructured } from "../src/lib/llm/registry";
import type { MasterProfile } from "../src/lib/types";
import { AI_SYSTEM, AiAnswers, buildAiPrompt, usableAnswers } from "./ai-answers-core";
import type { Pending } from "./form";
import type { Answer } from "./match";

/**
 * Answer the questions a form asked that the rules and the answer bank could not, from the profile only.
 * Never throws: with no model, or a model that fails, the questions stay unanswered and the application is handed back as before.
 */
export async function answerPending(o: { profile: MasterProfile; bank: Answer[]; job: { title: string; company: string; description?: string | null }; pending: Pending[]; jobId?: string }): Promise<Answer[]> {
  if (o.pending.length === 0) return [];
  try {
    const { output } = await runStructured({ task: "tailor", schema: AiAnswers, system: AI_SYSTEM, prompt: buildAiPrompt(o), jobId: o.jobId, prefer: "strong", budgetMs: 60_000 });
    return usableAnswers(o.pending, output);
  } catch (e) {
    console.error(`  Could not write answers with a model (${e instanceof Error ? e.message.split("\n")[0] : e}); those questions stay with you.`);
    return [];
  }
}
