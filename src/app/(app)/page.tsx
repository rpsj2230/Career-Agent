import Link from "next/link";
import { ActionButton } from "@/components/app/action-button";
import { StatusBadge } from "@/components/app/badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db, must } from "@/lib/db";
import { getProfile } from "@/lib/profile/store";
import { counts } from "@/lib/queries";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [c, profile, discovery] = await Promise.all([counts(), getProfile(), getSetting("discovery")]);
  const models = must<{ enabled: boolean; api_key_env: string | null }[]>(await db().from("model_configs").select("enabled,api_key_env"), "models");
  const recent = must<{ id: string; status: string; created_at: string; job: { title: string; company: string } | null }[]>(
    await db().from("applications").select("id,status,created_at, job:jobs(title,company)").order("created_at", { ascending: false }).limit(6), "recent",
  );
  const steps = [
    { done: profile.experience.length > 0, label: "Import and confirm your profile", href: "/profile" },
    { done: models.some((m) => m.enabled && (m.api_key_env === null || !!process.env[m.api_key_env])), label: "Add at least one model API key (free tiers work)", href: "/models" },
    { done: (discovery.roles.length || profile.preferences.roles.length) > 0, label: "Set the roles and countries to search", href: "/settings" },
  ];
  const ready = steps.every((s) => s.done);
  const tiles = [
    { label: "To score", value: c.fresh }, { label: "Matched, to review", value: c.queued }, { label: "Prepared", value: c.prepared },
    { label: "Sent (7 days)", value: c.sent7 }, { label: "Applied total", value: c.applied }, { label: "Needs attention", value: c.failed },
  ];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        {ready && (
          <div className="flex gap-2">
            <ActionButton method="GET" endpoint="/api/cron/discover" success="Discovery finished">Find jobs now</ActionButton>
            <ActionButton variant="outline" method="GET" endpoint="/api/cron/score" success="Scoring batch finished">Score new jobs</ActionButton>
          </div>
        )}
      </div>

      {!ready && (
        <Card className="border-amber-500">
          <CardHeader><CardTitle>Finish setup</CardTitle><CardDescription>The agent needs these before it can work.</CardDescription></CardHeader>
          <CardContent><ol className="grid gap-2 text-sm">
            {steps.map((s, i) => (
              <li key={i} className="flex items-center gap-2"><Badge variant={s.done ? "default" : "outline"}>{s.done ? "done" : "todo"}</Badge>{s.done ? s.label : <Link href={s.href} className="underline">{s.label}</Link>}</li>
            ))}
          </ol></CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <Card key={t.label}><CardHeader className="pb-1"><CardDescription>{t.label}</CardDescription><CardTitle className="text-3xl">{t.value}</CardTitle></CardHeader></Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>Recent applications</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {recent.length === 0 ? <p className="text-muted-foreground">None yet.</p> : recent.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2">
              <Link href={`/applications/${r.id}`} className="hover:underline"><span className="font-medium">{r.job?.title}</span> <span className="text-muted-foreground">{r.job?.company}</span></Link>
              <StatusBadge status={r.status} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
