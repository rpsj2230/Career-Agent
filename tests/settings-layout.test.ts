import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/app/(app)/settings/page.tsx", "utf8");
const form = readFileSync("src/components/app/settings-form.tsx", "utf8");
const table = readFileSync("src/lib/pipeline-table.ts", "utf8");

describe("Settings is laid out in the order the pipeline works", () => {
  it("has one section per step, in order, each with an anchor", () => {
    const ids = [...page.matchAll(/<SettingsSection id="([\w-]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["pause", "find", "score-match", "prepare", "approve-send", "after", "access"]);
  });
  it("names the sections after the steps", () => {
    for (const t of ["Step 1 · Find jobs", "Steps 2 and 3 · Score and match", "Step 4 · Prepare resumes and cover letters", "Steps 5 and 6 · Approve and send"]) expect(page).toContain(t);
  });
  it("renders every settings card of the form exactly once, in one of the sections", () => {
    for (const id of ["find", "score-match", "prepare", "send", "after"]) expect(page.match(new RegExp(`form\\("${id}"\\)`, "g"))).toHaveLength(1);
    const cards = [...form.matchAll(/<CardTitle>([^<]+)<\/CardTitle>/g)].map((m) => m[1]);
    expect(cards).toEqual(expect.arrayContaining(["Where to search and how far back", "Skip list: companies and words to ignore", "Score: how each job is rated", "Match: the minimum score", "Resume memory: reuse past resumes", "Sending limits: per day, LinkedIn, same company, hands-free", "Reply tracking: employers&apos; answers"]));
  });
  it("the links from the pipeline table land on those anchors", () => {
    for (const a of ["find", "score-match", "prepare", "approve-send"]) {
      expect(table).toContain(`/settings#${a}`);
      expect(page).toContain(`id="${a}"`);
    }
  });
});
