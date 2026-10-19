import { searchingCountries } from "@/lib/country-summary";
import { SkillGroups } from "@/components/app/skill-groups";
import { ProfileEditor } from "@/components/app/profile-editor";
import { AnswerBankEditor, DraftReview, ImportBox, PreferencesForm } from "@/components/app/profile-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db, must } from "@/lib/db";
import { getDraft, getProfile } from "@/lib/profile/store";
import { HandbackAnswers } from "@/components/app/handback-answers";
import { loadHandbacks } from "@/lib/apply/handbacks-store";
import { dedupeList } from "@/lib/country-prefs";
import { getSetting } from "@/lib/settings";
import { mergeStandard } from "@/lib/standard-questions";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const [profile, draft, searching, discovery] = await Promise.all([getProfile(), getDraft(), searchingCountries(), getSetting("discovery")]);
  const titles = [...new Set(profile.experience.map((e) => e.title.trim()).filter(Boolean))].slice(0, 6);
  // roles that were typed on the old Settings field are shown here too, and move to the profile on the next save
  const prefs = { ...profile.preferences, roles: dedupeList([...profile.preferences.roles, ...discovery.roles]) };
  const bank = must<{ question: string; answer: string }[]>(await db().from("answer_bank").select("question,answer").order("question"), "load answers");
  const handbacks = await loadHandbacks().catch(() => []);
  const empty = profile.experience.length === 0;
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">Profile</h1>

      {handbacks.length > 0 && (
        <Card className="border-amber-500">
          <CardHeader><CardTitle>Questions the agent could not answer</CardTitle><CardDescription>These stopped applications. Answer each once: it goes into your answer bank, and every application waiting for it returns to your queue with the answer filled in. Consent boxes are never answered for you.</CardDescription></CardHeader>
          <CardContent><HandbackAnswers groups={handbacks} /></CardContent>
        </Card>
      )}

      {draft && (
        <Card className="border-amber-500">
          <CardHeader><CardTitle>Review imported draft</CardTitle><CardDescription>Nothing is used for applications until you confirm. Extracted by {draft.model}.</CardDescription></CardHeader>
          <CardContent><DraftReview initial={draft.profile} conflicts={draft.conflicts} /></CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>{empty ? "Import your profile" : "Re-import your profile"}</CardTitle><CardDescription>Upload your master resume once (it fills your profile and builds the master resume template), plus your LinkedIn PDF for extra skills.</CardDescription></CardHeader>
        <CardContent><ImportBox /></CardContent>
      </Card>

      {!empty && (
        <Card>
          <CardHeader><CardTitle>{profile.basics.name || "Your profile"}</CardTitle><CardDescription>{profile.basics.headline} · {profile.basics.location}</CardDescription></CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <p>{profile.basics.summary}</p>
            <SkillGroups skills={profile.skills} />
            <p className="text-xs text-muted-foreground">Each responsibility or achievement below is one &quot;fact&quot;. Every fact is used: for matching jobs to you, and as the only material the agent may draw on when it builds a resume or cover letter for a job. Open a role to read its facts.</p>
            <div className="grid gap-2">
              {profile.experience.map((e) => (
                <details key={e.id} className="rounded-md border p-2">
                  <summary className="cursor-pointer"><span className="font-medium">{e.title}</span>, {e.company} <span className="text-muted-foreground">({e.start} - {e.end}) · {e.bullets.length} facts</span></summary>
                  <ul className="ml-5 mt-2 list-disc space-y-1">{e.bullets.map((b) => <li key={b.id}>{b.text}</li>)}</ul>
                </details>
              ))}
              {profile.education.length > 0 && <details className="rounded-md border p-2"><summary className="cursor-pointer font-medium">Education ({profile.education.length})</summary><ul className="ml-5 mt-2 list-disc space-y-1">{profile.education.map((d) => <li key={d.id}>{d.degree}, {d.school}{d.start || d.end ? ` (${[d.start, d.end].filter(Boolean).join(" - ")})` : ""}</li>)}</ul></details>}
              {([["Career highlights", profile.highlights.map((h) => h.text)], ["Case studies", profile.caseStudies.map((c) => c.title)], ["Certifications", profile.certifications.map((c) => c.name)], ["Professional development", profile.development.map((c) => c.name)], ["Awards and recognition", profile.awards.map((c) => c.name)]] as [string, string[]][]).filter(([, xs]) => xs.length > 0).map(([label, xs]) => (
                <details key={label} className="rounded-md border p-2"><summary className="cursor-pointer font-medium">{label} ({xs.length})</summary><ul className="ml-5 mt-2 list-disc space-y-1">{xs.map((x, i) => <li key={i}>{x}</li>)}</ul></details>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!empty && (
        <Card>
          <CardHeader><CardTitle>Edit your profile</CardTitle><CardDescription>Add, change or remove skills, or edit any field. Changes are used for job search, scoring and tailoring straight away.</CardDescription></CardHeader>
          <CardContent><ProfileEditor key={JSON.stringify(profile).length} profile={profile} /></CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Preferences</CardTitle><CardDescription>Used for discovery, scoring and pre-filled application answers.</CardDescription></CardHeader>
        <CardContent><PreferencesForm prefs={prefs} searching={searching} profileTitles={titles} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Answer bank</CardTitle><CardDescription>Standard questions that appear in most applications, pre-listed for you. Things already on your profile (experience, location, links, education) are filled in automatically when a form asks and you have not answered here.</CardDescription></CardHeader>
        <CardContent><AnswerBankEditor initial={mergeStandard(bank)} /></CardContent>
      </Card>
    </div>
  );
}
