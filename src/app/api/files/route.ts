import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/** The assistant's live picture of an application: its path is fixed, so the application's own id is what is checked. */
const LIVE = /^screenshots\/([0-9a-f-]{36})\/live\.jpg$/i;

/**
 * Redirects to a short-lived signed URL for a stored document or screenshot (access is gated by proxy.ts).
 * With `check=1` it answers in words instead, so a picture that does not load can say why.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const path = url.searchParams.get("path") ?? "";
  const check = url.searchParams.get("check") === "1";
  // stored paths are "<uuid>/<file>" or "screenshots/<uuid>/<file>"; reject anything else, incl. traversal
  if (!/^(screenshots\/)?[0-9a-f-]{36}\/[\w.-]+$/i.test(path)) return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  // only files that belong to the profile in use: a path found or guessed from another profile is "not found"
  const live = path.match(LIVE);
  const [doc, shot] = await Promise.all([
    db().from("documents").select("id").eq("storage_path", path).limit(1),
    live ? db().from("applications").select("id").eq("id", live[1]).limit(1) : db().from("applications").select("id").eq("screenshot_path", path).limit(1),
  ]);
  if (!doc.data?.length && !shot.data?.length) return NextResponse.json({ error: live ? "No application with this id in this profile" : "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const { data, error } = await db().storage.from("documents").createSignedUrl(path, 120);
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Not found", where: "the stored file" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  if (check) return NextResponse.json({ ok: true });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "no-store" } });
}
