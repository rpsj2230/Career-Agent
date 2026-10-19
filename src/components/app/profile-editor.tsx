"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { MasterProfile } from "@/lib/types";
import { call } from "./api";
import { nextSkillId, skillSection, SECTION_LABEL, type SkillSection } from "@/lib/profile/skills";
import { addFacts, addSkills, looksGrouped, parseFacts, parseSkillLines } from "@/lib/profile/bulk";

/** Edit the saved profile: add, change or remove skills with a form, or edit every field as JSON. Saving replaces the profile. */
export function ProfileEditor({ profile }: { profile: MasterProfile }) {
  const router = useRouter();
  const [skills, setSkills] = useState(profile.skills);
  const [experience, setExperience] = useState(profile.experience);
  const [bulk, setBulk] = useState("");
  const [bulkSection, setBulkSection] = useState<SkillSection>("competency");
  const [bulkGroup, setBulkGroup] = useState("");
  const [bulkFirst, setBulkFirst] = useState(false);
  const [bulkExtra, setBulkExtra] = useState(false);
  const [facts, setFacts] = useState<Record<string, string>>({});
  const [factsFirst, setFactsFirst] = useState(true);
  const [name, setName] = useState("");
  const [section, setSection] = useState<SkillSection>("technical");
  const [group, setGroup] = useState("");
  const [extra, setExtra] = useState(false);
  const [json, setJson] = useState(JSON.stringify(profile, null, 2));
  const [busy, setBusy] = useState(false);
  const groups = [...new Set(skills.map((s) => s.group).filter((g): g is string => !!g))];

  function add() {
    const n = name.trim();
    if (!n) return;
    if (skills.some((s) => s.name.toLowerCase() === n.toLowerCase())) return toast.error(`"${n}" is already in your skills`);
    setSkills((xs) => [...xs, { id: nextSkillId(xs), name: n, ...(group.trim() ? { group: group.trim() } : {}), ...(section !== "other" ? { kind: section } : {}), ...(extra ? { extra: true } : {}) }]);
    setName("");
  }
  function addMany() {
    const parsed = parseSkillLines(bulk);
    if (!parsed.length) return toast.error("Paste at least one skill first");
    const r = addSkills(skills, parsed, { section: bulkSection, group: bulkGroup, extra: bulkExtra, first: bulkFirst });
    setSkills(r.skills);
    setBulk("");
    toast.success(`${r.added.length} skill(s) added${r.skipped.length ? `; ${r.skipped.length} already there or repeated: ${r.skipped.slice(0, 5).join(", ")}${r.skipped.length > 5 ? "..." : ""}` : ""}. Press "Save skills and experience" to keep them.`);
  }
  function addFactsTo(id: string) {
    const list = parseFacts(facts[id] ?? "");
    if (!list.length) return toast.error("Paste the text first");
    const r = addFacts({ ...profile, skills, experience }, id, list, factsFirst);
    setExperience(r.experience);
    setFacts((f) => ({ ...f, [id]: "" }));
    toast.success(`${r.added} fact(s) added${r.skipped ? `; ${r.skipped} already there` : ""}. Press "Save skills and experience" to keep them.`);
  }
  async function save(next: unknown, ok: string) {
    setBusy(true);
    const res = await call("/api/profile/confirm", "POST", next, ok);
    setBusy(false);
    if (res) router.refresh();
  }
  async function saveJson() {
    let parsed: unknown;
    try { parsed = JSON.parse(json); } catch { return toast.error("That is not valid JSON"); }
    await save(parsed, "Profile saved");
  }

  const order: SkillSection[] = ["competency", "technical", "other"];
  return (
    <div className="grid gap-5">
      <section className="grid gap-3">
        <h3 className="text-sm font-semibold">Skills</h3>
        {order.map((sec) => {
          const rows = skills.filter((s) => skillSection(s) === sec);
          if (rows.length === 0) return null;
          const gs = [...new Set(rows.map((s) => s.group ?? ""))];
          return (
            <div key={sec} className="grid gap-1">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{SECTION_LABEL[sec]}</div>
              {gs.map((g) => (
                <div key={g} className="flex flex-wrap items-center gap-1">
                  {g && <span className="mr-1 text-xs font-medium">{g}:</span>}
                  {rows.filter((s) => (s.group ?? "") === g).map((s) => (
                    <Badge key={s.id} variant={s.extra ? "outline" : "secondary"} className="gap-1" title={s.extra ? "Used for matching; not printed in the master template" : undefined}>
                      {s.name}{s.extra && <span className="text-[10px] text-muted-foreground">search only</span>}
                      <button type="button" aria-label={`Remove ${s.name}`} className="ml-0.5 text-muted-foreground hover:text-foreground" onClick={() => setSkills((xs) => xs.filter((x) => x.id !== s.id))}>×</button>
                    </Badge>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
        <div className="grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_auto_1fr]">
          <div className="grid gap-1"><Label htmlFor="sk-name">Add a skill</Label><Input id="sk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Stakeholder Management" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} /></div>
          <div className="grid gap-1"><Label htmlFor="sk-sec">Section</Label>
            <select id="sk-sec" className="h-9 rounded-md border bg-background px-2 text-sm" value={section} onChange={(e) => setSection(e.target.value as SkillSection)}>
              {order.map((s) => <option key={s} value={s}>{SECTION_LABEL[s]}</option>)}
            </select></div>
          <div className="grid gap-1"><Label htmlFor="sk-group">Heading (optional)</Label><Input id="sk-group" list="sk-groups" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="e.g. Platforms" /><datalist id="sk-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist></div>
          <label className="flex items-center gap-2 text-xs md:col-span-3"><Checkbox checked={extra} onCheckedChange={(v) => setExtra(v === true)} /> Search and scoring only: do not print it in the master resume template</label>
          <div className="flex gap-2 md:col-span-3"><Button type="button" variant="outline" onClick={add}>Add skill</Button>
            <Button type="button" disabled={busy} onClick={() => save({ ...profile, skills, experience }, "Skills and experience saved")}>{busy ? "Saving..." : "Save skills and experience"}</Button></div>
        </div>
      </section>

      <section className="grid gap-2 rounded-md border p-3">
        <h3 className="text-sm font-semibold">Add many skills at once</h3>
        <p className="text-xs text-muted-foreground">Paste a list, one skill per line (numbers and bullets are removed), or &quot;Heading: skill, skill, skill&quot; lines as under Technical Skills. Skills already there are skipped. The order saved is the order printed, so tick &quot;put first&quot; for your top skills.</p>
        <Textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={8} aria-label="Skills to add" placeholder={"1. Artificial Intelligence (AI)\n2. Generative AI\n3. Digital Transformation"} />
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1"><Label htmlFor="bk-sec">Section</Label>
            <select id="bk-sec" className="h-9 rounded-md border bg-background px-2 text-sm" value={bulkSection} onChange={(e) => setBulkSection(e.target.value as SkillSection)}>{order.map((x) => <option key={x} value={x}>{SECTION_LABEL[x]}</option>)}</select></div>
          <div className="grid gap-1"><Label htmlFor="bk-group">Heading for plain lines (optional)</Label><Input id="bk-group" className="w-56" value={bulkGroup} onChange={(e) => setBulkGroup(e.target.value)} placeholder="e.g. Delivery & Project Management" /></div>
          <label className="flex items-center gap-2 text-xs"><Checkbox checked={bulkFirst} onCheckedChange={(v) => setBulkFirst(v === true)} /> Put these first</label>
          <label className="flex items-center gap-2 text-xs"><Checkbox checked={bulkExtra} onCheckedChange={(v) => setBulkExtra(v === true)} /> Search and scoring only (not printed)</label>
          <Button type="button" variant="outline" onClick={addMany}>Add these skills</Button>
        </div>
        {bulk.trim() && <p className="text-xs text-muted-foreground">{looksGrouped(bulk) ? "Read as headed lines: " : "Read as one skill per line: "}{parseSkillLines(bulk).length} skill(s) found.</p>}
      </section>

      <section className="grid gap-2">
        <h3 className="text-sm font-semibold">Experience facts</h3>
        <p className="text-xs text-muted-foreground">Each responsibility or achievement is one fact; the agent can only use facts that are here. Open a role to correct or remove a fact, or paste a description and bullets to add several (the opening sentence becomes its own fact).</p>
        {experience.map((e) => (
          <details key={e.id} className="rounded-md border p-2">
            <summary className="cursor-pointer text-sm"><span className="font-medium">{e.title}</span>, {e.company} <span className="text-muted-foreground">· {e.bullets.length} fact(s)</span></summary>
            <div className="mt-2 grid gap-2">
              {e.bullets.map((b) => (
                <div key={b.id} className="flex items-start gap-2">
                  <Textarea value={b.text} rows={2} aria-label="Fact" className="text-xs" onChange={(ev) => setExperience((xs) => xs.map((x) => (x.id === e.id ? { ...x, bullets: x.bullets.map((y) => (y.id === b.id ? { ...y, text: ev.target.value } : y)) } : x)))} />
                  <Button type="button" variant="ghost" size="sm" aria-label="Remove this fact" onClick={() => setExperience((xs) => xs.map((x) => (x.id === e.id ? { ...x, bullets: x.bullets.filter((y) => y.id !== b.id) } : x)))}>Remove</Button>
                </div>
              ))}
              <Label htmlFor={`f-${e.id}`}>Add facts to this role</Label>
              <Textarea id={`f-${e.id}`} rows={6} value={facts[e.id] ?? ""} onChange={(ev) => setFacts((f) => ({ ...f, [e.id]: ev.target.value }))} placeholder={"Built and scaled the maintenance and renewals function...\n\n• Identified recurring revenue as an untapped growth channel...\n• Re-skilled operations teams across WooCommerce, Magento and Shopify..."} />
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" onClick={() => addFactsTo(e.id)}>Add these facts</Button>
                <label className="flex items-center gap-2 text-xs"><Checkbox checked={factsFirst} onCheckedChange={(v) => setFactsFirst(v === true)} /> Put them at the top of the role</label>
              </div>
            </div>
          </details>
        ))}
        <div><Button type="button" disabled={busy} onClick={() => save({ ...profile, skills, experience }, "Skills and experience saved")}>{busy ? "Saving..." : "Save skills and experience"}</Button></div>
      </section>

      <details className="grid gap-2">
        <summary className="cursor-pointer text-sm font-semibold">Edit the whole profile as JSON (advanced)</summary>
        <div className="mt-2 grid gap-2">
          <p className="text-xs text-muted-foreground">Every field is here: summary, highlights, experience, certifications and the rest. Keep each item&apos;s <code>id</code> and make sure ids are unique; new items need a new unique id. The file is checked before saving.</p>
          <Textarea value={json} onChange={(e) => setJson(e.target.value)} rows={24} className="font-mono text-xs" aria-label="Profile JSON" />
          <div className="flex gap-2"><Button type="button" disabled={busy} onClick={saveJson}>Save JSON</Button>
            <Button type="button" variant="outline" onClick={() => setJson(JSON.stringify(profile, null, 2))}>Reset</Button></div>
        </div>
      </details>
    </div>
  );
}
