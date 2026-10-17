import { searchingCountries } from "@/lib/country-summary";
import { AnswerBankEditor, DraftReview, ImportBox, PreferencesForm } from "@/components/app/profile-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db, must } from "@/lib/db";
import { getDraft, getProfile } from "@/lib/profile/store";
import { HandbackAnswers } from "@/components/app/handback-answers";
import { loadHandbacks } from "@/lib/apply/handbacks-store";
import { mergeStandard } from "@/lib/standard-questions";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const [profile, draft, searching] = await Promise.all([getProfile(), getDraft(), searchingCountries()]);
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
        <CardHeader><CardTitle>{empty ? "Import your profile" : "Re-import or add another source"}</CardTitle><CardDescription>Upload your resume and/or your LinkedIn data export (Settings, Data privacy, Get a copy of your data).</CardDescription></CardHeader>
        <CardContent><ImportBox /></CardContent>
      </Card>

      {!empty && (
        <Card>
          <CardHeader><CardTitle>{profile.basics.name || "Your profile"}</CardTitle><CardDescription>{profile.basics.headline} · {profile.basics.location}</CardDescription></CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <p>{profile.basics.summary}</p>
            <div className="flex flex-wrap gap-1">{profile.skills.map((s) => <Badge key={s.id} variant="secondary">{s.name}</Badge>)}</div>
            <p className="text-xs text-muted-foreground">Each responsibility or achievement below is one &quot;fact&quot;. Every fact is used: for matching jobs to you, and as the only material the agent may draw on when it builds a resume or cover letter for a job. Open a role to read its facts.</p>
            <div className="grid gap-2">
              {profile.experience.map((e) => (
                <details key={e.id} className="rounded-md border p-2">
                  <summary className="cursor-pointer"><span className="font-medium">{e.title}</span>, {e.company} <span className="text-muted-foreground">({e.start} - {e.end}) · {e.bullets.length} facts</span></summary>
                  <ul className="ml-5 mt-2 list-disc space-y-1">{e.bullets.map((b) => <li key={b.id}>{b.text}</li>)}</ul>
                </details>
              ))}
              {profile.education.length > 0 && <details className="rounded-md border p-2"><summary className="cursor-pointer font-medium">Education ({profile.education.length})</summary><ul className="ml-5 mt-2 list-disc space-y-1">{profile.education.map((d) => <li key={d.id}>{d.degree}, {d.school}{d.start || d.end ? ` (${[d.start, d.end].filter(Boolean).join(" - ")})` : ""}</li>)}</ul></details>}
              {profile.certifications.length > 0 && <details className="rounded-md border p-2"><summary className="cursor-pointer font-medium">Certifications and awards ({profile.certifications.length})</summary><ul className="ml-5 mt-2 list-disc space-y-1">{profile.certifications.map((c) => <li key={c.id}>{c.name}</li>)}</ul></details>}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Preferences</CardTitle><CardDescription>Used for discovery, scoring and pre-filled application answers.</CardDescription></CardHeader>
        <CardContent><PreferencesForm prefs={profile.preferences} searching={searching} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Answer bank</CardTitle><CardDescription>Standard questions that appear in most applications, pre-listed for you. Things already on your profile (experience, location, links, education) are filled in automatically when a form asks and you have not answered here.</CardDescription></CardHeader>
        <CardContent><AnswerBankEditor initial={mergeStandard(bank)} /></CardContent>
      </Card>
    </div>
  );
}
