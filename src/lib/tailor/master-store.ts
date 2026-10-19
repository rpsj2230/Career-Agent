import "server-only";
import { db } from "@/lib/db";
import { getSetting, putSetting } from "@/lib/settings";

/** Your own resume file, exactly as you uploaded it. It is the fallback when a tailored resume cannot be made. */
export type MasterResume = { path: string; name: string; size: number; uploaded_at: string };

const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
export { masterExt } from "./master-store-pure";
import { masterExt } from "./master-store-pure";

export async function getMasterInfo(): Promise<MasterResume | null> {
  const v = await getSetting("master_resume").catch(() => null);
  return v && typeof v === "object" && "path" in v ? (v as MasterResume) : null;
}

/** Keep the file (PDF or DOCX, up to 10 MB). Replaces the previous one. Returns null when it is not a resume file. */
export async function saveMasterResume(name: string, bytes: Uint8Array): Promise<MasterResume | null> {
  const ext = masterExt(name);
  if (!ext || bytes.byteLength === 0 || bytes.byteLength > 10 * 1024 * 1024) return null;
  const path = `master/original-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const up = await db().storage.from("documents").upload(path, Buffer.from(bytes), { contentType: TYPES[ext], upsert: true });
  if (up.error) throw new Error(`could not store the master resume: ${up.error.message}`);
  const prev = await getMasterInfo();
  const info: MasterResume = { path, name: name.replace(/[^\w.\- ]+/g, "_").slice(0, 120), size: bytes.byteLength, uploaded_at: new Date().toISOString() };
  await putSetting("master_resume", info);
  if (prev?.path) await db().storage.from("documents").remove([prev.path]).catch(() => undefined);
  return info;
}

export async function loadMasterFile(): Promise<{ bytes: Buffer; ext: string; info: MasterResume } | null> {
  const info = await getMasterInfo();
  const ext = info ? masterExt(info.path) : null;
  if (!info || !ext) return null;
  const { data, error } = await db().storage.from("documents").download(info.path);
  if (error || !data) return null;
  return { bytes: Buffer.from(await data.arrayBuffer()), ext, info };
}

export async function masterSignedUrl(): Promise<string | null> {
  const info = await getMasterInfo();
  if (!info) return null;
  const { data } = await db().storage.from("documents").createSignedUrl(info.path, 120, { download: info.name });
  return data?.signedUrl ?? null;
}
