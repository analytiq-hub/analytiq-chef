importScripts("lib/logger.js", "lib/storage.js");

const SWEEP_ALARM = "ac_sweep";

/**
 * In-memory map: tabId → jobId for tabs we opened and are waiting on.
 * Lost if the service worker is killed; recoverStuckJobs() handles that.
 */
const pendingTabs = new Map();

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: 1 });
  void sweepDueJobs();
  void updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: 1 });
  void recoverStuckJobs();
  void updateBadge();
});

// ---------------------------------------------------------------------------
// Alarm sweep
// ---------------------------------------------------------------------------

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SWEEP_ALARM) void sweepDueJobs();
});

async function sweepDueJobs() {
  await recoverStuckJobs();
  const jobs = await listJobs();
  const now = Date.now();
  for (const job of jobs) {
    if (job.status !== "pending") continue;
    if (new Date(job.scheduledFor).getTime() > now) continue;
    await processJob(job);
  }
}

/**
 * Jobs stuck in "opening" for more than 2 minutes are failed.
 * This handles service worker restarts that cleared pendingTabs.
 */
async function recoverStuckJobs() {
  const jobs = await listJobs();
  const cutoff = Date.now() - 2 * 60 * 1000;
  for (const job of jobs) {
    if (job.status !== "opening") continue;
    if (new Date(job.updatedAt).getTime() < cutoff) {
      await updateJob(job.id, {
        status: "failed",
        lastError: "ERR_TAB_OPEN: timed out (extension restarted while opening tab)",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Job processing
// ---------------------------------------------------------------------------

async function processJob(job) {
  const contact = await getContactById(job.contactId);
  if (!contact) {
    await updateJob(job.id, { status: "failed", lastError: "ERR_NO_CONTACT: contact not found" });
    return;
  }
  try {
    await updateJob(job.id, { status: "opening" });
    const tab = await chrome.tabs.create({ url: contact.linkedinProfileUrl, active: true });
    await updateJob(job.id, { openedTabId: tab.id });
    pendingTabs.set(tab.id, job.id);
  } catch (e) {
    await updateJob(job.id, {
      status: "failed",
      lastError: `ERR_TAB_OPEN: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Tab coordination — inject draft when the opened tab finishes loading
// ---------------------------------------------------------------------------

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  if (!pendingTabs.has(tabId)) return;
  void injectDraft(tabId);
});

async function injectDraft(tabId) {
  const jobId = pendingTabs.get(tabId);
  pendingTabs.delete(tabId);

  const jobs = await listJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job || job.status !== "opening") return;

  // Retry sending the message a few times — the content script may not be
  // registered immediately after the page reports "complete".
  let result = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      result = await chrome.tabs.sendMessage(tabId, {
        type: "INSERT_DRAFT",
        text: job.finalMessage,
      });
      break;
    } catch {
      if (attempt === 5) {
        await updateJob(job.id, {
          status: "failed",
          lastError: "ERR_DRAFT_INSERT: could not reach content script after retries",
        });
        await updateBadge();
        return;
      }
      await sleep(1000);
    }
  }

  if (result && result.ok) {
    await updateJob(job.id, { status: "drafted", draftedAt: new Date().toISOString() });
  } else {
    await updateJob(job.id, {
      status: "failed",
      lastError: result?.error || "ERR_DRAFT_INSERT",
    });
  }
  await updateBadge();
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[JOBS_KEY]) void updateBadge();
});

async function updateBadge() {
  try {
    const jobs = await listJobs();
    const count = jobs.filter((j) => j.status === "drafted").length;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#00838f" });
  } catch {
    // ignore — badge is non-critical
  }
}

// ---------------------------------------------------------------------------
// Messages from popup
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "UPDATE_BADGE") {
    void updateBadge().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
