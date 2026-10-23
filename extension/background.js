importScripts("lib.js", "run.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function loaded(tabId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(onUpdated); resolve(); };
    const onUpdated = (id, info) => { if (id === tabId && info.status === "complete") done(); };
    chrome.tabs.onUpdated.addListener(onUpdated);
    setTimeout(done, timeoutMs);
  });
}

/** Open an application's form in a new tab, fill it, attach its resume, and stop: you read it and press Submit. */
async function openAndFill(id) {
  await CA.refresh();
  const { fillData } = await chrome.storage.local.get("fillData");
  const item = fillData && (fillData.queue || []).find((q) => q.id === id);
  if (!item) return { error: "That application is no longer in your list" };
  const tab = await chrome.tabs.create({ url: item.formUrl, active: true });
  await loaded(tab.id);
  let report = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(attempt === 0 ? 1500 : 3000); // single-page forms draw themselves after the page has loaded
    try { report = await CA.fillTab(tab.id, item); } catch (e) { report = { filled: [], forYou: [], secret: [], files: { attached: [], missing: [] }, error: e.message }; }
    if (report.filled.length || report.error) break;
  }
  await chrome.storage.local.set({ ["report:" + id]: { ...report, at: Date.now(), tabId: tab.id } });
  chrome.action.setBadgeText({ text: report.error ? "!" : String(report.forYou.length || "✓") });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === "open-and-fill") { openAndFill(msg.id).then(reply, (e) => reply({ error: e.message })); return true; }
  return false;
});
