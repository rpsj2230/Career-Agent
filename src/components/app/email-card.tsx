"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { call } from "./api";

export type EmailView = {
  to: string; subject: string; body: string; auto: boolean; verified: boolean; edited?: boolean; mode: "only" | "also";
  alternatives: { email: string; why: string }[]; issues: { where: string; problem: string }[]; quality?: { score: number; words: number };
  sent?: { at: string; to: string; attachments: string[] } | null; lastError?: string | null;
};

/** The email that goes to the employer with the resume and cover letter attached: read it, edit it, send it. */
export function EmailCard({ id, status, draft, listed }: { id: string; status: string; draft: EmailView | null; listed: string[] }) {
  const router = useRouter();
  const [to, setTo] = useState(draft?.to ?? listed[0] ?? "");
  const [subject, setSubject] = useState(draft?.subject ?? "");
  const [body, setBody] = useState(draft?.body ?? "");
  const [auto, setAuto] = useState(draft?.auto ?? true);
  const [busy, setBusy] = useState<string | null>(null);
  const sending = status === "approved" || status === "submitting";

  async function act(name: string, payload: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(name);
    const r = await call<{ note?: string }>(`/api/applications/${id}/email`, "POST", payload);
    setBusy(null);
    if (r) { toast.success(r.note ?? "Done"); router.refresh(); }
  }
  const dirty = !!draft && (to !== draft.to || subject !== draft.subject || body !== draft.body || auto !== draft.auto);

  if (!draft) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Email to the employer</CardTitle>
          <CardDescription>
            Sending your resume and cover letter by email, with a message on why you fit, gives a second chance of being seen alongside the normal application.
            {listed.length ? ` The posting lists ${listed.join(", ")}.` : " The posting lists no email address; if you know one, type it in."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1"><label className="text-xs font-medium" htmlFor="em-to">Send to</label><Input id="em-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="hiring@company.com" className="w-72" /></div>
          <Button disabled={busy !== null || !to} onClick={() => act("write", { action: "write", to })}>{busy === "write" ? "Writing…" : "Write the email"}</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Email to the employer
          {draft.sent ? <Badge>Sent {new Date(draft.sent.at).toLocaleString()}</Badge> : <Badge variant="outline">Not sent yet</Badge>}
          <Badge variant="secondary">{draft.mode === "only" ? "This email is the application" : "In addition to the normal application"}</Badge>
          {draft.verified ? <Badge variant="secondary">{draft.edited ? "edited by you" : "verified"}</Badge> : <Badge variant="destructive">{draft.issues.length} claim(s) unverified</Badge>}
        </CardTitle>
        <CardDescription>
          Sent from your own mailbox with the resume and cover letter attached, so the hiring manager sees why you fit. {draft.auto ? "It is sent automatically when you approve the application." : "Automatic sending is off for this email: press Send when ready."}
          {draft.quality ? ` Aimed at this job: ${draft.quality.score}/100 (${draft.quality.words} words).` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {draft.lastError && <p className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-900">The last attempt failed: {draft.lastError}</p>}
        {!draft.verified && draft.issues.length > 0 && <ul className="list-disc pl-5 text-xs text-destructive">{draft.issues.slice(0, 5).map((i, k) => <li key={k}>{i.where}: {i.problem}</li>)}</ul>}
        <div className="grid gap-1"><label className="text-xs font-medium" htmlFor="em-to2">To</label>
          <Input id="em-to2" type="email" value={to} onChange={(e) => setTo(e.target.value)} disabled={sending} />
          {draft.alternatives.length > 0 && <p className="text-xs text-muted-foreground">Other addresses in the posting: {draft.alternatives.map((a, k) => <button key={k} type="button" className="mr-2 underline" onClick={() => setTo(a.email)}>{a.email}</button>)}</p>}
        </div>
        <div className="grid gap-1"><label className="text-xs font-medium" htmlFor="em-sub">Subject</label><Input id="em-sub" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={140} disabled={sending} /></div>
        <div className="grid gap-1"><label className="text-xs font-medium" htmlFor="em-body">Message</label><Textarea id="em-body" rows={12} value={body} onChange={(e) => setBody(e.target.value)} maxLength={6000} disabled={sending} /></div>
        <p className="text-xs text-muted-foreground">Attached when sent: your tailored resume and cover letter for this application (the newest versions).</p>
        <label className="flex items-center gap-2 text-sm"><Switch checked={auto} onCheckedChange={setAuto} />Send it automatically when I approve this application</label>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!dirty || busy !== null} onClick={async () => { setBusy("save"); const r = await call(`/api/applications/${id}/email`, "POST", { action: "save", to, subject, body, auto }, "Saved"); setBusy(null); if (r) router.refresh(); }}>Save changes</Button>
          <Button disabled={busy !== null || sending || dirty} title={dirty ? "Save your changes first" : undefined}
            onClick={() => act("send", { action: "send", to, resend: !!draft.sent, override: !draft.verified || undefined }, draft.sent ? `This was already sent to ${draft.sent.to}. Send it again?` : !draft.verified ? "Some claims in this email could not be verified against your profile. Send anyway?" : undefined)}>
            {busy === "send" ? "Sending…" : draft.sent ? "Send again" : "Send now"}
          </Button>
          <Button variant="outline" disabled={busy !== null || sending} onClick={() => act("write", { action: "write", to }, dirty ? "This replaces your unsaved edits with a new email. Continue?" : undefined)}>{busy === "write" ? "Writing…" : "Write it again"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
