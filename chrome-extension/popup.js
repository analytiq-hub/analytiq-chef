const PROFILE_URL_RE = /^https:\/\/(www\.)?linkedin\.com\/in\/[^/?#]+\/?/i;

/**
 * Without the extension context, `chrome.storage` is undefined (e.g. opening
 * popup.html as a file). With no `storage` permission, `chrome.storage` is also undefined.
 */
function assertExtensionStorage() {
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
    throw new Error(
      "chrome.storage is not available. Load this extension with 'Load unpacked' on chrome://extensions and open the popup from the toolbar—not by opening popup.html in a tab. After editing manifest.json, click Reload on the extension card."
    );
  }
}

const el = {
  globalError: document.getElementById("global-error"),
  campaignSelect: document.getElementById("campaign-select"),
  campaignName: document.getElementById("campaign-name"),
  sequenceEditor: document.getElementById("sequence-editor"),
  btnNew: document.getElementById("btn-new-campaign"),
  btnClone: document.getElementById("btn-clone-campaign"),
  btnAddStep: document.getElementById("btn-add-step"),
  btnSave: document.getElementById("btn-save-campaign"),
  btnDelete: document.getElementById("btn-delete-campaign"),
  currentTabHint: document.getElementById("current-tab-hint"),
  btnAddProfile: document.getElementById("btn-add-profile"),
  contactsList: document.getElementById("contacts-list"),
  contactsEmpty: document.getElementById("contacts-empty"),
  queueList: document.getElementById("queue-list"),
  queueEmpty: document.getElementById("queue-empty"),
  btnExport: document.getElementById("btn-export"),
  importFile: document.getElementById("import-file"),
  captureLogs: document.getElementById("capture-logs"),
  logPanel: document.getElementById("log-panel"),
  btnLogRefresh: document.getElementById("btn-log-refresh"),
  btnLogCopy: document.getElementById("btn-log-copy"),
  btnLogClear: document.getElementById("btn-log-clear"),
};

/** In-memory draft for the sequence while editing (mirrors selected campaign). */
let draftMessages = [""];

/** True while the user has clicked New but hasn't saved the campaign yet. */
let pendingNew = false;

// ---------------------------------------------------------------------------
// Error display
// ---------------------------------------------------------------------------

function setError(message) {
  if (!message) {
    el.globalError.hidden = true;
    el.globalError.textContent = "";
    return;
  }
  el.globalError.textContent = message;
  el.globalError.hidden = false;
}

// ---------------------------------------------------------------------------
// Campaign helpers
// ---------------------------------------------------------------------------

function getSelectedCampaignId() {
  return el.campaignSelect.value || null;
}

async function refreshCampaignSelect(selectedId) {
  const { campaigns } = await loadAll();
  el.campaignSelect.innerHTML = "";
  if (!campaigns.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "(no campaigns — create one)";
    el.campaignSelect.appendChild(opt);
    el.campaignSelect.disabled = true;
    return null;
  }
  el.campaignSelect.disabled = pendingNew;
  for (const c of campaigns) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    el.campaignSelect.appendChild(opt);
  }
  const pick =
    selectedId && campaigns.some((c) => c.id === selectedId)
      ? selectedId
      : campaigns[0].id;
  el.campaignSelect.value = pick;
  return pick;
}

function renderSequenceEditor() {
  el.sequenceEditor.innerHTML = "";
  draftMessages.forEach((body, index) => {
    const wrap = document.createElement("div");
    wrap.className = "seq-step";
    const head = document.createElement("div");
    head.className = "seq-step-head";
    const lab = document.createElement("span");
    lab.className = "seq-label";
    lab.textContent = `Message ${index + 1}`;
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "seq-remove";
    rm.textContent = "Remove";
    rm.disabled = draftMessages.length <= 1;
    rm.addEventListener("click", () => {
      if (draftMessages.length <= 1) return;
      draftMessages.splice(index, 1);
      renderSequenceEditor();
    });
    head.appendChild(lab);
    head.appendChild(rm);
    const ta = document.createElement("textarea");
    ta.className = "seq-body";
    ta.value = body;
    ta.placeholder = `Hi _FN_, …`;
    ta.addEventListener("input", () => {
      draftMessages[index] = ta.value;
    });
    wrap.appendChild(head);
    wrap.appendChild(ta);
    el.sequenceEditor.appendChild(wrap);
  });
}

async function loadCampaignIntoForm(campaignId) {
  const { campaigns } = await loadAll();
  const c = campaigns.find((x) => x.id === campaignId);
  if (!c) return;
  el.campaignName.value = c.name;
  draftMessages = c.messages.length ? [...c.messages] : [""];
  renderSequenceEditor();
}

// ---------------------------------------------------------------------------
// Contacts list (with per-contact Schedule button)
// ---------------------------------------------------------------------------

async function renderContactsList() {
  const campaignId = getSelectedCampaignId();
  el.contactsList.innerHTML = "";
  if (!campaignId) {
    el.contactsEmpty.classList.remove("hidden");
    return;
  }
  const { campaigns } = await loadAll();
  const campaign = campaigns.find((c) => c.id === campaignId);
  const contacts = await listContactsForCampaign(campaignId);
  if (!contacts.length) {
    el.contactsEmpty.classList.remove("hidden");
    return;
  }
  el.contactsEmpty.classList.add("hidden");
  const firstTemplate = campaign && campaign.messages[0] != null ? campaign.messages[0] : "";
  for (const contact of contacts) {
    const li = document.createElement("li");
    li.className = "contact-item";

    const name = document.createElement("p");
    name.className = "contact-name";
    name.textContent = contact.fullName;

    const meta = document.createElement("p");
    meta.className = "contact-meta";
    const a = document.createElement("a");
    a.href = contact.linkedinProfileUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = contact.linkedinProfileUrl;
    meta.appendChild(a);

    li.appendChild(name);
    li.appendChild(meta);

    if (firstTemplate.trim()) {
      const prev = document.createElement("p");
      prev.className = "contact-preview";
      prev.textContent = `Step 1 preview: ${replaceFnPlaceholder(firstTemplate, contact.firstName)}`;
      li.appendChild(prev);
    }

    const actions = document.createElement("div");
    actions.className = "contact-actions";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn-link";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", async () => {
      if (!confirm(`Remove ${contact.fullName} from this campaign?`)) return;
      await removeContact(contact.id);
      await renderContactsList();
    });

    const schedBtn = document.createElement("button");
    schedBtn.type = "button";
    schedBtn.className = "btn-link btn-link-schedule";
    schedBtn.textContent = "Schedule message";
    schedBtn.addEventListener("click", () => {
      const existing = li.querySelector(".schedule-form");
      if (existing) { existing.remove(); return; }
      if (!campaign) { setError("Campaign not found."); return; }
      li.appendChild(buildScheduleForm(contact, campaign));
    });

    actions.appendChild(removeBtn);
    actions.appendChild(document.createTextNode(" · "));
    actions.appendChild(schedBtn);
    li.appendChild(actions);
    el.contactsList.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// Schedule form (per contact)
// ---------------------------------------------------------------------------

function localDatetimeValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function buildScheduleForm(contact, campaign) {
  const wrap = document.createElement("div");
  wrap.className = "schedule-form";

  // Step selector (only shown when there is more than one message)
  let stepSelect = null;
  if (campaign.messages.length > 1) {
    const row = document.createElement("div");
    row.className = "schedule-row";
    const lbl = document.createElement("label");
    lbl.className = "label";
    lbl.textContent = "Message step";
    stepSelect = document.createElement("select");
    stepSelect.className = "select";
    campaign.messages.forEach((_, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = `Step ${i + 1}`;
      stepSelect.appendChild(opt);
    });
    row.appendChild(lbl);
    row.appendChild(stepSelect);
    wrap.appendChild(row);
  }

  // Date/time picker
  const timeRow = document.createElement("div");
  timeRow.className = "schedule-row";
  const timeLbl = document.createElement("label");
  timeLbl.className = "label";
  timeLbl.textContent = "Send at";
  const timeInput = document.createElement("input");
  timeInput.type = "datetime-local";
  timeInput.className = "input";
  timeInput.value = localDatetimeValue(new Date(Date.now() + 5 * 60 * 1000));
  timeRow.appendChild(timeLbl);
  timeRow.appendChild(timeInput);
  wrap.appendChild(timeRow);

  // Live preview
  const preview = document.createElement("p");
  preview.className = "schedule-preview";
  function updatePreview() {
    const idx = stepSelect ? parseInt(stepSelect.value, 10) : 0;
    const msg = campaign.messages[idx] || "";
    preview.textContent = replaceFnPlaceholder(msg, contact.firstName);
  }
  updatePreview();
  if (stepSelect) stepSelect.addEventListener("change", updatePreview);
  wrap.appendChild(preview);

  // Action buttons
  const btnRow = document.createElement("div");
  btnRow.className = "btn-row";

  const queueBtn = document.createElement("button");
  queueBtn.type = "button";
  queueBtn.className = "btn btn-primary";
  queueBtn.textContent = "Add to queue";
  queueBtn.addEventListener("click", async () => {
    const stepIndex = stepSelect ? parseInt(stepSelect.value, 10) : 0;
    const scheduledFor = new Date(timeInput.value).toISOString();
    const finalMessage = replaceFnPlaceholder(
      campaign.messages[stepIndex] || "",
      contact.firstName
    );
    try {
      await createJob({ campaignId: campaign.id, contactId: contact.id, stepIndex, finalMessage, scheduledFor });
      log("popup: scheduled job for", contact.fullName, "step", stepIndex + 1);
      wrap.remove();
      await renderQueue();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-secondary";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => wrap.remove());

  btnRow.appendChild(queueBtn);
  btnRow.appendChild(cancelBtn);
  wrap.appendChild(btnRow);

  return wrap;
}

// ---------------------------------------------------------------------------
// Queue rendering
// ---------------------------------------------------------------------------

const STATUS_LABELS = {
  pending: "Pending",
  opening: "Opening…",
  drafted: "Ready to send",
  sent_manually: "Sent",
  failed: "Failed",
  cancelled: "Cancelled",
};

function formatScheduledFor(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

function notifyBadgeUpdate() {
  chrome.runtime.sendMessage({ type: "UPDATE_BADGE" }).catch(() => {});
}

async function renderQueue() {
  const [jobs, { contacts, campaigns }] = await Promise.all([listJobs(), loadAll()]);

  el.queueList.innerHTML = "";

  // Show everything except old completed/cancelled jobs to keep the list manageable
  const active = jobs.filter((j) => !["sent_manually", "cancelled"].includes(j.status));

  if (!active.length) {
    el.queueEmpty.hidden = false;
    return;
  }
  el.queueEmpty.hidden = true;

  // Sort: action-needed first, then by scheduled time
  const priority = { drafted: 0, failed: 1, opening: 2, pending: 3 };
  active.sort((a, b) => {
    const pa = priority[a.status] ?? 9;
    const pb = priority[b.status] ?? 9;
    if (pa !== pb) return pa - pb;
    return new Date(a.scheduledFor) - new Date(b.scheduledFor);
  });

  for (const job of active) {
    const contact = contacts.find((c) => c.id === job.contactId);
    const campaign = campaigns.find((c) => c.id === job.campaignId);
    el.queueList.appendChild(renderJobItem(job, contact, campaign));
  }
}

function renderJobItem(job, contact, campaign) {
  const li = document.createElement("li");
  li.className = "queue-item";

  // — Info column —
  const info = document.createElement("div");
  info.className = "queue-item-info";

  const nameEl = document.createElement("span");
  nameEl.className = "queue-contact-name";
  nameEl.textContent = contact ? contact.fullName : "(unknown contact)";

  const stepEl = document.createElement("span");
  stepEl.className = "queue-step";
  const campaignName = campaign ? campaign.name : "Unknown campaign";
  stepEl.textContent = `${campaignName} · Step ${job.stepIndex + 1}`;

  const whenEl = document.createElement("span");
  whenEl.className = "queue-when";
  whenEl.textContent = formatScheduledFor(job.scheduledFor);

  const statusEl = document.createElement("span");
  statusEl.className = `queue-status queue-status-${job.status}`;
  statusEl.textContent = STATUS_LABELS[job.status] || job.status;

  info.appendChild(nameEl);
  info.appendChild(stepEl);
  info.appendChild(whenEl);
  info.appendChild(statusEl);

  if (job.status === "failed" && job.lastError) {
    const errEl = document.createElement("span");
    errEl.className = "queue-error";
    errEl.textContent = job.lastError;
    info.appendChild(errEl);
  }

  // — Actions column —
  const actionsEl = document.createElement("div");
  actionsEl.className = "queue-item-actions";

  if (job.status === "drafted") {
    // "Go to tab" focuses the already-open LinkedIn tab
    if (job.openedTabId) {
      const goBtn = document.createElement("button");
      goBtn.type = "button";
      goBtn.className = "btn btn-secondary btn-tiny";
      goBtn.textContent = "Go to tab";
      goBtn.addEventListener("click", async () => {
        try { await chrome.tabs.update(job.openedTabId, { active: true }); } catch { /* tab may be closed */ }
      });
      actionsEl.appendChild(goBtn);
    }

    const markSentBtn = document.createElement("button");
    markSentBtn.type = "button";
    markSentBtn.className = "btn btn-primary btn-tiny";
    markSentBtn.textContent = "Mark sent";
    markSentBtn.addEventListener("click", async () => {
      await updateJob(job.id, { status: "sent_manually", sentManuallyAt: new Date().toISOString() });
      await renderQueue();
      notifyBadgeUpdate();
    });
    actionsEl.appendChild(markSentBtn);
  }

  if (job.status === "failed") {
    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "btn btn-secondary btn-tiny";
    retryBtn.textContent = "Retry";
    retryBtn.addEventListener("click", async () => {
      await updateJob(job.id, { status: "pending", lastError: null, openedTabId: null });
      await renderQueue();
    });
    actionsEl.appendChild(retryBtn);
  }

  if (["pending", "opening", "drafted", "failed"].includes(job.status)) {
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn-link btn-tiny";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", async () => {
      await updateJob(job.id, { status: "cancelled" });
      await renderQueue();
      notifyBadgeUpdate();
    });
    actionsEl.appendChild(cancelBtn);
  }

  li.appendChild(info);
  li.appendChild(actionsEl);
  return li;
}

// ---------------------------------------------------------------------------
// Tab hint
// ---------------------------------------------------------------------------

async function updateTabHint() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !tab.url) {
      el.currentTabHint.textContent = "No active tab.";
      el.btnAddProfile.disabled = true;
      return;
    }
    const ok = PROFILE_URL_RE.test(tab.url);
    if (ok) {
      el.currentTabHint.textContent = tab.url;
      el.btnAddProfile.disabled = !getSelectedCampaignId();
    } else {
      el.currentTabHint.textContent =
        "Open a LinkedIn profile URL like linkedin.com/in/username/ to add a contact.";
      el.btnAddProfile.disabled = true;
    }
  } catch (e) {
    el.currentTabHint.textContent = e instanceof Error ? e.message : String(e);
    el.btnAddProfile.disabled = true;
  }
}

// ---------------------------------------------------------------------------
// Campaign select change
// ---------------------------------------------------------------------------

el.campaignSelect.addEventListener("change", async () => {
  setError("");
  const id = getSelectedCampaignId();
  if (id) await loadCampaignIntoForm(id);
  await renderContactsList();
  await updateTabHint();
});

// ---------------------------------------------------------------------------
// New campaign
// ---------------------------------------------------------------------------

el.btnNew.addEventListener("click", () => {
  setError("");
  pendingNew = true;
  el.btnNew.disabled = true;
  el.btnClone.disabled = true;
  el.campaignSelect.disabled = true;
  el.campaignName.value = "";
  draftMessages = [""];
  renderSequenceEditor();
  el.campaignName.focus();
});

// ---------------------------------------------------------------------------
// Clone campaign
// ---------------------------------------------------------------------------

el.btnClone.addEventListener("click", async () => {
  const id = getSelectedCampaignId();
  if (!id) return;
  setError("");
  try {
    const { campaigns } = await loadAll();
    const src = campaigns.find((c) => c.id === id);
    if (!src) return;
    const clone = await createCampaign(`${src.name} (copy)`, [...src.messages]);
    log("popup: cloned campaign", src.id, "→", clone.id);
    await refreshCampaignSelect(clone.id);
    await loadCampaignIntoForm(clone.id);
    await renderContactsList();
    await updateTabHint();
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
  }
});

// ---------------------------------------------------------------------------
// Add message step
// ---------------------------------------------------------------------------

el.btnAddStep.addEventListener("click", () => {
  draftMessages.push("");
  renderSequenceEditor();
});

// ---------------------------------------------------------------------------
// Save campaign
// ---------------------------------------------------------------------------

el.btnSave.addEventListener("click", async () => {
  setError("");
  const name = el.campaignName.value.trim();
  if (!name) {
    setError("Campaign name is required.");
    el.campaignName.focus();
    return;
  }
  const emptyIndex = draftMessages.findIndex((m) => !m.trim());
  if (emptyIndex !== -1) {
    setError(`Message ${emptyIndex + 1} is empty.`);
    el.sequenceEditor.querySelectorAll(".seq-body")[emptyIndex]?.focus();
    return;
  }
  let id = pendingNew ? null : getSelectedCampaignId();
  try {
    if (!id) {
      const c = await createCampaign(name, draftMessages);
      log("popup: created campaign via save", c.id, c.name);
      id = c.id;
      pendingNew = false;
      el.btnNew.disabled = false;
      el.btnClone.disabled = false;
    } else {
      await updateCampaign(id, { name, messages: draftMessages });
      log("popup: saved campaign", id);
    }
    await refreshCampaignSelect(id);
    await renderContactsList();
    await updateTabHint();
  } catch (e) {
    error("popup: save campaign failed", e);
    setError(e instanceof Error ? e.message : String(e));
  }
});

// ---------------------------------------------------------------------------
// Delete / cancel new campaign
// ---------------------------------------------------------------------------

el.btnDelete.addEventListener("click", async () => {
  if (pendingNew) {
    pendingNew = false;
    el.btnNew.disabled = false;
    el.btnClone.disabled = false;
    setError("");
    const first = await refreshCampaignSelect(null);
    if (first) await loadCampaignIntoForm(first);
    else { el.campaignName.value = ""; draftMessages = [""]; renderSequenceEditor(); }
    await renderContactsList();
    await updateTabHint();
    return;
  }
  const id = getSelectedCampaignId();
  if (!id) return;
  if (!confirm("Delete this campaign and all enrolled contacts?")) return;
  setError("");
  try {
    await deleteCampaign(id);
    const next = await refreshCampaignSelect(null);
    if (next) await loadCampaignIntoForm(next);
    else { el.campaignName.value = ""; draftMessages = [""]; renderSequenceEditor(); }
    await renderContactsList();
    await updateTabHint();
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
  }
});

// ---------------------------------------------------------------------------
// Add profile from current tab
// ---------------------------------------------------------------------------

el.btnAddProfile.addEventListener("click", async () => {
  setError("");
  const campaignId = getSelectedCampaignId();
  if (!campaignId) { setError("Select a campaign first."); return; }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !PROFILE_URL_RE.test(tab.url)) {
    setError("Active tab must be a LinkedIn profile (/in/…).");
    return;
  }
  log("popup: add profile → tab", tab.id, tab.url);
  try {
    const profile = await chrome.tabs.sendMessage(tab.id, { type: "GET_PROFILE" });
    if (!profile || !profile.profileUrl) {
      warn("popup: empty profile from content script");
      setError("Could not read profile from this page.");
      return;
    }
    await addContactToCampaign(campaignId, {
      linkedinProfileUrl: profile.profileUrl,
      fullName: profile.fullName || "",
      firstName: profile.firstName || "",
    });
    log("popup: contact added", profile.profileUrl, "→ campaign", campaignId);
    await renderContactsList();
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e
      ? String(/** @type {{ message?: string }} */ (e).message)
      : String(e);
    error("popup: add profile failed", msg);
    if (msg.includes("Receiving end does not exist")) {
      setError("Reload the LinkedIn profile tab so the extension can attach, then try again.");
    } else {
      setError(msg);
    }
  }
});

// ---------------------------------------------------------------------------
// Export / Import
// ---------------------------------------------------------------------------

el.btnExport.addEventListener("click", async () => {
  try {
    const [{ campaigns, contacts }, jobs] = await Promise.all([loadAll(), listJobs()]);
    const payload = JSON.stringify({ campaigns, contacts, jobs }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytiq-chef-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    log("popup: exported data");
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
  }
});

el.importFile.addEventListener("change", async () => {
  const file = el.importFile.files[0];
  if (!file) return;
  if (!confirm("Import will replace all current campaigns, contacts, and jobs. Continue?")) {
    el.importFile.value = "";
    return;
  }
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data.campaigns) || !Array.isArray(data.contacts)) {
      throw new Error("Invalid export file: missing campaigns or contacts arrays.");
    }
    await chrome.storage.local.set({
      ac_campaigns: data.campaigns,
      ac_campaign_contacts: data.contacts,
      [JOBS_KEY]: Array.isArray(data.jobs) ? data.jobs : [],
    });
    log("popup: imported data", data.campaigns.length, "campaigns,", data.contacts.length, "contacts");
    el.importFile.value = "";
    const first = await refreshCampaignSelect(null);
    if (first) await loadCampaignIntoForm(first);
    else { el.campaignName.value = ""; draftMessages = [""]; renderSequenceEditor(); }
    await renderContactsList();
    await updateTabHint();
    await renderQueue();
    notifyBadgeUpdate();
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
    el.importFile.value = "";
  }
});

// ---------------------------------------------------------------------------
// Logs UI
// ---------------------------------------------------------------------------

async function refreshLogPanel() {
  const entries = await getLogs();
  if (!entries.length) {
    el.logPanel.textContent = "(no log lines yet — interact with the extension or a LinkedIn profile tab.)";
    return;
  }
  el.logPanel.textContent = entries.map(formatLogLine).join("\n");
  el.logPanel.scrollTop = el.logPanel.scrollHeight;
}

async function initLogsUi() {
  el.captureLogs.checked = await getCaptureLogs();
  el.captureLogs.addEventListener("change", async () => {
    await setCaptureLogs(el.captureLogs.checked);
    log("popup: capture logs", el.captureLogs.checked);
    await refreshLogPanel();
  });
  el.btnLogRefresh.addEventListener("click", () => refreshLogPanel());
  el.btnLogClear.addEventListener("click", async () => {
    await clearLogs();
    await refreshLogPanel();
  });
  el.btnLogCopy.addEventListener("click", async () => {
    const text = el.logPanel.textContent || "";
    try {
      await navigator.clipboard.writeText(text);
      log("popup: copied logs to clipboard");
    } catch (e) {
      error("popup: clipboard copy failed", e);
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.ac_dev_logs) return;
    void refreshLogPanel();
  });
  await refreshLogPanel();
}

// ---------------------------------------------------------------------------
// Storage change listener — keep queue in sync when background updates jobs
// ---------------------------------------------------------------------------

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[JOBS_KEY]) return;
  void renderQueue();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  try {
    assertExtensionStorage();
    setError("");
    const first = await refreshCampaignSelect(null);
    if (first) await loadCampaignIntoForm(first);
    else { el.campaignName.value = ""; draftMessages = [""]; renderSequenceEditor(); }
    await renderContactsList();
    await updateTabHint();
    await renderQueue();
    await initLogsUi();
    await log("popup: opened");
    await refreshLogPanel();
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
  }
}

init();
