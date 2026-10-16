import { NextResponse } from "next/server";
import { z } from "zod";
import { putSetting } from "@/lib/settings";

const list = z.array(z.string().trim().min(1).max(80)).max(50);
const Schemas = {
  discovery: z.object({
    countries: z.array(z.string().length(2).transform((c) => c.toLowerCase())).max(30),
    roles: list, greenhouse_boards: list, lever_companies: list, max_age_days: z.number().int().min(1).max(90),
  }),
  scoring: z.object({ threshold: z.number().int().min(0).max(100) }),
  caps: z.object({
    daily_total: z.number().int().min(0).max(100), daily_linkedin: z.number().int().min(0).max(50),
    weekly_linkedin: z.number().int().min(0).max(200), linkedin_automation_enabled: z.boolean(),
  }),
} as const;

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as { key?: keyof typeof Schemas; value?: unknown } | null;
  const schema = body?.key && Schemas[body.key];
  if (!schema) return NextResponse.json({ error: "Unknown setting" }, { status: 400 });
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  await putSetting(body.key!, parsed.data);
  return NextResponse.json({ ok: true });
}
