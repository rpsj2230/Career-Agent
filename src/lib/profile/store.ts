import "server-only";
import { db, must } from "@/lib/db";
import { MasterProfile } from "@/lib/types";

export const EMPTY_PROFILE: MasterProfile = MasterProfile.parse({ basics: {}, preferences: { countries: [], roles: [] } });

export async function getProfile(): Promise<MasterProfile> {
  const row = must(await db().from("profile").select("data").eq("id", 1).maybeSingle(), "load profile");
  const parsed = MasterProfile.safeParse(row?.data ?? {});
  return parsed.success ? parsed.data : EMPTY_PROFILE;
}

export async function saveProfile(p: MasterProfile) {
  must(await db().from("profile").upsert({ id: 1, data: p, updated_at: new Date().toISOString() }).select(), "save profile");
}

export async function getDraft() {
  const row = must(await db().from("settings").select("value").eq("key", "profile_draft").maybeSingle(), "load draft");
  return (row?.value ?? null) as { profile: MasterProfile; conflicts: string[]; model: string } | null;
}

export async function saveDraft(draft: { profile: MasterProfile; conflicts: string[]; model: string }) {
  must(await db().from("settings").upsert({ key: "profile_draft", value: draft, updated_at: new Date().toISOString() }).select(), "save draft");
}

export async function clearDraft() {
  must(await db().from("settings").delete().eq("key", "profile_draft").select(), "clear draft");
}
