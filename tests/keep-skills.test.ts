import { describe, expect, it } from "vitest";
import { MasterProfile } from "@/lib/types";
import { keepCurrentSkills } from "@/lib/profile/skills";

const mk = (names: string[]) => MasterProfile.parse({ basics: {}, skills: names.map((name, i) => ({ id: `skill${i + 1}`, name })) });

describe("keepCurrentSkills", () => {
  it("carries over hand-added skills the new profile lacks, without duplicates or id clashes", () => {
    const { profile, kept } = keepCurrentSkills(mk(["AI", "Python"]), mk(["python", "Prompt Engineering", "Power BI", " ai "]));
    expect(kept).toBe(2);
    expect(profile.skills.map((s) => s.name)).toEqual(["AI", "Python", "Prompt Engineering", "Power BI"]);
    expect(new Set(profile.skills.map((s) => s.id)).size).toBe(4);
  });
  it("keeps nothing when the new profile already has everything", () => {
    expect(keepCurrentSkills(mk(["A"]), mk(["a"])).kept).toBe(0);
  });
});

import { masterAsTailored, resumeView } from "@/lib/tailor/sections";

describe("technical skills lines", () => {
  it("drops a stray line that only repeats the other headings, and repeated skills", () => {
    const sk = (id: string, name: string, group: string) => ({ id, name, group, kind: "technical" as const });
    const p = MasterProfile.parse({ basics: {}, skills: [
      sk("skill1", "WordPress", "Web"), sk("skill2", "wordpress", "Web"), sk("skill3", "Figma", "Design"),
      sk("skill4", "Web", "TECHNICAL SKILLS"), sk("skill5", "Design", "TECHNICAL SKILLS"),
    ] });
    expect(resumeView(p, masterAsTailored(p)).technical).toEqual([{ group: "Web", items: ["WordPress"] }, { group: "Design", items: ["Figma"] }]);
  });
});
