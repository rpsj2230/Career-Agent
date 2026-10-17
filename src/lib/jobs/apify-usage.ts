import "server-only";
import { db, must } from "@/lib/db";
import { getSetting } from "@/lib/settings";

const KEY = "apify_usage";
const month = (d = new Date()) => d.toISOString().slice(0, 7);

/** Jobs fetched through Apify this calendar month, kept so a scheduled run can never spend past the budget you set. */
async function used(): Promise<number> {
  const row = must<{ value: { month: string; items: number } } | null>(await db().from("settings").select("value").eq("key", KEY).maybeSingle(), "load Apify usage");
  return row?.value?.month === month() ? row.value.items : 0;
}

export async function apifyBudget(): Promise<{ remaining: () => Promise<number>; record: (n: number) => Promise<void> }> {
  const { monthly_item_budget } = await getSetting("apify");
  return {
    remaining: async () => (monthly_item_budget > 0 ? Math.max(0, monthly_item_budget - (await used())) : Number.MAX_SAFE_INTEGER),
    record: async (n) => {
      if (n <= 0) return;
      must(await db().from("settings").upsert({ key: KEY, value: { month: month(), items: (await used()) + n }, updated_at: new Date().toISOString() }).select("key"), "save Apify usage");
    },
  };
}
