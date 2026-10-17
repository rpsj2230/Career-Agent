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
            <ul className="grid gap-1">{profile.experience.map((e) => <li key={e.id}><span className="font-medium">{e.title}</span>, {e.company} <span className="text-muted-foreground">({e.start} - {e.end}) · {e.bullets.length} facts</span></li>)}</ul>
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
