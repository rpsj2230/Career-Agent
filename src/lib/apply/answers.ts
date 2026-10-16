import type { MasterProfile } from "@/lib/types";

export type Answer = { question: string; answer: string; source: "answer_bank" | "profile" };

/** Answer bank first; common India/visa questions are filled from profile preferences when not in the bank. */
export function buildAnswers(bank: { question: string; answer: string }[], prefs: MasterProfile["preferences"]): Answer[] {
  const out: Answer[] = bank.filter((b) => b.answer.trim()).map((b) => ({ question: b.question, answer: b.answer, source: "answer_bank" as const }));
  const has = (re: RegExp) => out.some((a) => re.test(a.question));
  const add = (question: string, answer: string | undefined, re: RegExp) => {
    if (answer && !has(re)) out.push({ question, answer, source: "profile" });
  };
  add("Current CTC", prefs.currentCtc, /current.*(ctc|salary)/i);
  add("Expected CTC", prefs.expectedCtc, /expected.*(ctc|salary)/i);
  add("Notice period", prefs.noticePeriod, /notice/i);
  add("Work authorisation / visa status", prefs.visaStatus, /visa|authori[sz]ation/i);
  if (prefs.relocate !== undefined) add("Willing to relocate?", prefs.relocate ? "Yes" : "No", /relocat/i);
  return out;
}
