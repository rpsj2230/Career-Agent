import { NextResponse } from "next/server";
import { z } from "zod";
import { db, must } from "@/lib/db";

const slug = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
const Body = z.object({ items: z.array(z.object({ question: z.string().min(2).max(300), answer: z.string().max(2000) })).max(200) });

/** Replaces the whole answer bank with the submitted list. */
export async function PUT(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid answers" }, { status: 400 });
  const rows = [...new Map(parsed.data.items.map((i) => [slug(i.question), { key: slug(i.question), ...i, updated_at: new Date().toISOString() }])).values()].filter((r) => r.key);
  const existing = must<{ key: string }[]>(await db().from("answer_bank").select("key"), "load answer bank");
  const gone = existing.map((e) => e.key).filter((k) => !rows.some((r) => r.key === k));
  if (gone.length) must(await db().from("answer_bank").delete().in("key", gone).select("key"), "prune answers");
  if (rows.length) must(await db().from("answer_bank").upsert(rows, { onConflict: "key" }).select("key"), "save answers");
  return NextResponse.json({ ok: true });
}
