import "server-only";
import { logConfig } from "@/lib/activity-helpers";
import { AUTOPILOT } from "@/lib/autopilot";
import { BLANK_SCHEDULE, type ScheduleConfig } from "@/lib/schedule";
import { createSchedule, listSchedules, updateSchedule } from "@/lib/schedule-store";
import { appTimezone } from "@/lib/time";
import { getSetting, putSetting } from "@/lib/settings";

const toConfig = (s: ScheduleConfig): ScheduleConfig => ({
  name: s.name, enabled: s.enabled, frequency: s.frequency, days: s.days, interval_hours: s.interval_hours, time_of_day: s.time_of_day, timezone: s.timezone,
  countries: s.countries, integrations: s.integrations, mode: s.mode, require_approval: s.require_approval, max_prepare: s.max_prepare, max_apply: s.max_apply,
});

/** Turn Autopilot on or off. On: every switch and limit it needs is set in one go, and every schedule is made to apply without asking. Off: schedules ask again. */
export async function setAutopilot(on: boolean): Promise<{ schedules: number }> {
  const { rows } = await listSchedules();
  if (on) {
    const caps = await getSetting("caps");
    await putSetting("autoapply", { enabled: true });
    await putSetting("caps", { ...caps, ...AUTOPILOT.caps });
    await putSetting("auto_prepare", AUTOPILOT.autoPrepare);
    const a = AUTOPILOT.schedule;
    for (const s of rows) await updateSchedule(s.id, { ...toConfig(s), mode: a.mode, require_approval: a.require_approval, max_prepare: a.max_prepare, max_apply: a.max_apply, frequency: a.frequency, interval_hours: a.interval_hours, days: [], enabled: true });
    if (rows.length === 0) await createSchedule({ ...BLANK_SCHEDULE, name: "Autopilot", timezone: appTimezone(), ...a, days: [] });
    await putSetting("autopilot", { enabled: true, since: new Date().toISOString() });
    await putSetting("cloud_assist", { enabled: true });
  } else {
    for (const s of rows) if (s.mode === "scan_prepare_apply") await updateSchedule(s.id, { ...toConfig(s), require_approval: true });
    await putSetting("autopilot", { enabled: false, since: "" });
    await putSetting("cloud_assist", { enabled: false });
  }
  await logConfig(`Autopilot switched ${on ? "on" : "off"}`, { schedules: rows.length });
  return { schedules: rows.length || (on ? 1 : 0) };
}
