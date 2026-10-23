importScripts("lib.js", "run.js");

/** Open an application's form in a new tab, fill it, attach its resume, and stop: you read it and press Submit (the manual button). */
async function openAndFill(id) {
  await CA.refresh();
  const { fillData } = await chrome.storage.local.get("fillData");
  const item = fillData && (fillData.queue || []).find((q) => q.id === id);
  if (!item) return { error: "That application is no longer in your list" };
  const tab = await chrome.tabs.create({ url: item.formUrl, active: true });
  await CA.loaded(tab.id);
  let report = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    await CA.sleep(attempt === 0 ? 1500 : 3000); // single-page forms draw themselves after the page has loaded
    try { report = await CA.fillTab(tab.id, item); } catch (e) { report = { filled: [], forYou: [], secret: [], files: { attached: [], missing: [] }, error: e.message }; }
    if (report.filled.length || report.error) break;
  }
  await chrome.storage.local.set({ ["report:" + id]: { ...report, at: Date.now(), tabId: tab.id } });
  chrome.action.setBadgeText({ text: report.error ? "!" : String(report.forYou.length || "✓") });
  return { ok: true };
}

let running = false;
/** The automatic mode: the waiting list, one application after another, sent by itself. Only runs when the owner switched it on and Career Agent allows it. */
async function runAutomatic(trigger) {
  if (running) return { busy: true };
  running = true;
  await chrome.storage.local.set({ autoRunning: { since: Date.now(), trigger } });
  chrome.action.setBadgeText({ text: "…" });
  try {
    const { results, stopped } = await CA.runQueue();
    const sent = results.filter((r) => r.outcome === "submitted").length;
    await chrome.storage.local.set({ autoLast: { at: Date.now(), results, stopped, trigger } });
    chrome.action.setBadgeText({ text: sent ? String(sent) : results.length ? "!" : "" });
    return { ok: true, sent };
  } catch (e) {
    await chrome.storage.local.set({ autoLast: { at: Date.now(), results: [], stopped: e.message, trigger } });
    chrome.action.setBadgeText({ text: "!" });
    return { error: e.message };
  } finally {
    running = false;
    await chrome.storage.local.remove("autoRunning");
  }
}

async function syncAlarm() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  // only the default (fallback) mode runs by itself; "manual only" never does
  if (settings.autoRun && (settings.mode || "fallback") === "fallback") await chrome.alarms.create("queue", { delayInMinutes: 1, periodInMinutes: 30 });
  else await chrome.alarms.clear("queue");
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg) return false;
  if (msg.type === "open-and-fill") { openAndFill(msg.id).then(reply, (e) => reply({ error: e.message })); return true; }
  if (msg.type === "run-automatic") { runAutomatic("button").then(reply, (e) => reply({ error: e.message })); return true; }
  if (msg.type === "settings-changed") { syncAlarm().then(() => reply({ ok: true })); return true; }
  return false;
});
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "queue") return;
  const { settings = {} } = await chrome.storage.local.get("settings");
  if (settings.autoRun && (settings.mode || "fallback") === "fallback") runAutomatic("timer");
});
chrome.runtime.onStartup.addListener(syncAlarm);
chrome.runtime.onInstalled.addListener(syncAlarm);
