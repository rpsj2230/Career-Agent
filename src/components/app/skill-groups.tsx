import { Badge } from "@/components/ui/badge";
import { skillSection, SECTION_LABEL, type SkillSection } from "@/lib/profile/skills";
import type { MasterProfile } from "@/lib/types";

/** The skills the way the resume prints them: by section, then by heading, in the order saved (so the first ones lead). */
export function SkillGroups({ skills }: { skills: MasterProfile["skills"] }) {
  const order: SkillSection[] = ["competency", "technical", "other"];
  return (
    <div className="grid gap-3">
      {order.map((sec) => {
        const rows = skills.filter((s) => skillSection(s) === sec);
        if (rows.length === 0) return null;
        const groups = [...new Set(rows.map((s) => s.group ?? ""))];
        return (
          <div key={sec} className="grid gap-1">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{SECTION_LABEL[sec]} ({rows.length})</div>
            {groups.map((g) => (
              <div key={g} className="flex flex-wrap items-center gap-1">
                {g && <span className="mr-1 text-xs font-medium">{g}:</span>}
                {rows.filter((s) => (s.group ?? "") === g).map((s) => <Badge key={s.id} variant={s.extra ? "outline" : "secondary"}>{s.name}</Badge>)}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
