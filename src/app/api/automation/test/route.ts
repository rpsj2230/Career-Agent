import { NextResponse } from "next/server";
import { testGithub } from "@/lib/github-test";

export const maxDuration = 30;

/** "Test GitHub connection" on the System page. Read-only: nothing is started. */
export async function POST() {
  const r = await testGithub();
  const bad = r.steps.filter((s) => !s.ok);
  return NextResponse.json({ ...r, note: bad.length ? `Not ready: ${bad.map((s) => `${s.label}: ${s.detail}`).join(" | ")}` : "GitHub is connected: the token works and both workflows are enabled." }, { status: 200 });
}
