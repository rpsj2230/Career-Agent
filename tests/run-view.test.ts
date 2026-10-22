import { describe, expect, it } from "vitest";
import { leftReasons, modelLines, runCounts, stepRows, taskLabel } from "@/lib/run-view";

const stats = { inserted: 174, scored: 64, matched: 32, prepared: 20, auto_approved: 5, manual_required: 3, left_cooldown: 4, left_cap: 2, scan_errors: 1, failed: 2, prepare_failed: 1, rejected: 32, rejected_by_rules: 10, model_calls: 7, duplicates: 12 };

describe("runCounts", () => {
  it("reads the six numbers a run shows everywhere", () => {
    expect(runCounts(stats)).toEqual({ found: 174, scored: 64, matched: 32, prepared: 20, approved: 8, left: 6, problems: 4 });
  });
  it("is all zeros for a run that recorded nothing", () => {
    expect(runCounts(null)).toEqual({ found: 0, scored: 0, matched: 0, prepared: 0, approved: 0, left: 0, problems: 0 });
    expect(runCounts({})).toEqual(runCounts(undefined));
  });
});

describe("leftReasons", () => {
  it("explains each reason in words, biggest first", () => {
    expect(leftReasons(stats).map((r) => [r.count, r.text])).toEqual([[4, "applied to the same company recently"], [2, "the daily limit was reached"]]);
  });
  it("still says something for a reason it does not know", () => {
    expect(leftReasons({ left_something_new: 3 })[0].text).toBe("something new");
  });
});

const sources = [{ source: "Adzuna", scans: 60, failed: 0, fetched: 900, inserted: 150 }, { source: "LinkedIn (Apify)", scans: 11, failed: 1, fetched: 40, inserted: 24 }];

describe("stepRows", () => {
  it("describes every step in one row, with the numbers of this run", () => {
    const rows = stepRows(stats, sources, { threshold: 65, mode: "scan_prepare_apply" });
    expect(rows.map((r) => r.step)).toEqual(["1. Find", "2. Score", "3. Match", "4. Prepare", "5. Approve"]);
    expect(rows[0].result).toBe("174 new");
    expect(rows[0].detail).toContain("71 searches on 2 sources");
    expect(rows[0].detail).toContain("1 search failed");
    expect(rows[0].tone).toBe("warn");
    expect(rows[1].result).toBe("64 scored");
    expect(rows[1].detail).toContain("10 dropped by your rules");
    expect(rows[2].detail).toContain("65 or more");
    expect(rows[3].result).toBe("20 prepared");
    expect(rows[4].result).toBe("8 approved");
    expect(rows[4].detail).toContain("4 applied to the same company recently");
  });
  it("says so when a schedule only searches and scores", () => {
    const rows = stepRows({ inserted: 5, scored: 5 }, sources, { threshold: 65, mode: "scan" });
    expect(rows[3].detail).toMatch(/only searches and scores/);
    expect(rows[4].result).toBe("-");
  });
  it("says so when a schedule waits for your approval", () => {
    expect(stepRows({ prepared: 3 }, [], { threshold: 65, mode: "scan_prepare" })[4].detail).toMatch(/waits for you to approve/);
  });
  it("does not pretend a search happened in a backlog-only round", () => {
    expect(stepRows({ scored: 20 }, [], { threshold: 65, mode: "scan_prepare_apply" })[0].detail).toMatch(/only worked through the backlog/);
  });
});

describe("modelLines", () => {
  const u = (model_label: string, task: string, ok: boolean, ms: number | null, i = 100, o = 50, error: string | null = null) => ({ model_label, task, ok, error, input_tokens: i, output_tokens: o, latency_ms: ms });
  it("sums calls, failures, tokens and average speed per model and task", () => {
    const lines = modelLines([u("gemini-flash", "score", true, 1000), u("gemini-flash", "score", true, 3000), u("gemini-flash", "score", false, null, 0, 0, "429 rate limit"), u("groq-llama", "tailor", true, 2000)]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ model: "gemini-flash", task: "score", calls: 3, ok: 2, failed: 1, inputTokens: 200, outputTokens: 100, avgMs: 2000, lastError: "429 rate limit" });
    expect(lines[1]).toMatchObject({ model: "groq-llama", task: "tailor", calls: 1, avgMs: 2000, lastError: null });
  });
  it("is empty when nothing was called", () => { expect(modelLines([])).toEqual([]); });
  it("names the task in plain words", () => {
    expect(taskLabel("score")).toBe("Scoring jobs");
    expect(taskLabel("tailor")).toBe("Writing resume and cover letter");
    expect(taskLabel("mystery")).toBe("mystery");
  });
});
