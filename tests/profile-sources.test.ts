import { describe, expect, it } from "vitest";
import { assignIds, ExtractedProfile } from "@/lib/profile/ids";
import { duplicateId, nextSkillId, skillSection } from "@/lib/profile/skills";
import { masterAsTailored, resumeView } from "@/lib/tailor/sections";
import { MasterProfile } from "@/lib/types";

const prefs = { countries: [], roles: [] };
const extracted = (skills: unknown[]) => ExtractedProfile.parse({ basics: { name: "A" }, experience: [{ company: "C", title: "T", bullets: ["did x"] }], skills });

describe("supporting sources only add extra skills", () => {
  it("keeps the master resume's skills and marks LinkedIn-only skills as extra", () => {
    const p = assignIds(extracted([
      { name: "SQL", group: "Tools", kind: "technical" },
      { name: "Public Speaking", extra: true },
    ]), prefs);
    expect(p.skills.map((s) => [s.name, s.extra ?? false])).toEqual([["SQL", false], ["Public Speaking", true]]);
  });

  it("does not add a supporting skill the master resume already lists, whatever the order or case", () => {
    const p = assignIds(extracted([{ name: "sql", extra: true }, { name: "SQL", kind: "technical" }, { name: "Python", extra: true }, { name: "python", extra: true }]), prefs);
    expect(p.skills.map((s) => s.name)).toEqual(["SQL", "Python"]);
  });

  it("extra skills are used for matching but stay out of the master template", () => {
    const p = assignIds(extracted([{ name: "SQL", kind: "technical" }, { name: "Public Speaking", extra: true }]), prefs);
    const t = masterAsTailored(p);
    expect(t.skillIds).toHaveLength(1);
    expect(resumeView(p, t).technical.flatMap((g) => g.items)).toEqual(["SQL"]);
    expect(JSON.stringify(resumeView(p, t))).not.toContain("Public Speaking");
    expect(p.skills.map((s) => s.name)).toContain("Public Speaking"); // still in the profile for scoring and tailoring
  });

  it("reads a string flag from a ready-made JSON file", () => {
    expect(extracted([{ name: "Go", extra: "true" }]).skills[0].extra).toBe(true);
  });
});

describe("profile editing helpers", () => {
  it("new skill ids never collide, even after removals", () => {
    expect(nextSkillId([])).toBe("skill1");
    expect(nextSkillId([{ id: "skill1" }, { id: "skill7" }])).toBe("skill8");
    expect(nextSkillId([{ id: "custom" }, { id: "skill2" }])).toBe("skill3");
  });
  it("sorts skills into sections", () => {
    expect(skillSection({ id: "a", name: "a", kind: "technical" })).toBe("technical");
    expect(skillSection({ id: "a", name: "a" })).toBe("other");
  });
  it("finds a duplicated id anywhere in the profile", () => {
    const base = MasterProfile.parse({ basics: { name: "A" }, preferences: prefs, skills: [{ id: "skill1", name: "x" }], highlights: [{ id: "hl1", text: "t" }] });
    expect(duplicateId(base)).toBeNull();
    expect(duplicateId({ ...base, highlights: [{ id: "skill1", text: "t" }] })).toBe("skill1");
  });
});
