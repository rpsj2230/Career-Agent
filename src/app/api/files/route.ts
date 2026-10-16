import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/** Redirects to a short-lived signed URL for a stored document or screenshot (access is gated by proxy.ts). */
export async function GET(request: Request) {
  const path = new URL(request.url).searchParams.get("path") ?? "";
  // stored paths are "<uuid>/<file>" or "screenshots/<uuid>/<file>"; reject anything else, incl. traversal
  if (!/^(screenshots\/)?[0-9a-f-]{36}\/[\w.-]+$/i.test(path)) return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  const { data, error } = await db().storage.from("documents").createSignedUrl(path, 120);
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Not found" }, { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
