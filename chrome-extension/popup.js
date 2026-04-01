const PROFILE_URL_RE = /^https:\/\/(www\.)?linkedin\.com\/in\/[^/?#]+\/?/i;

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
  contactsPagination: document.getElementById("contacts-pagination"),
  contactsEmpty: document.getElementById("contacts-empty"),
  campaignPreview: document.getElementById("campaign-preview"),
  previewContactSelect: document.getElementById("preview-contact-select"),
  previewSteps: document.getElementById("preview-steps"),
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

/**
 * In-memory draft steps while editing.
 * @type {{ body: string; delayDays: number; delayHours: number }[]}
 */
let draftSteps = [{ body: "", delayDays: 0, delayHours: 0 }];

/** True while the user has clicked New but hasn't saved yet. */
let pendingNew = false;

/** Cached contacts for the currently selected campaign (used by preview). */
let previewContacts = [];

const CONTACTS_PAGE_SIZE = 10;
/** Zero-based page index into the current campaign's contact list. */
let contactsListPage = 0;
/** Used to reset pagination when the active campaign changes. */
let lastContactsListCampaignId = null;

/**
 * @param {{ firstName: string; fullName: string }} contact
 * @returns {string}
 */
function contactInitials(contact) {
  const raw = (contact.firstName || contact.fullName || "?").trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] || "?").slice(0, 2).toUpperCase();
}

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

// ---------------------------------------------------------------------------
// Sequence editor with per-step delay inputs
// ---------------------------------------------------------------------------

function renderSequenceEditor() {
  el.sequenceEditor.innerHTML = "";
  draftSteps.forEach((step, index) => {
    const wrap = document.createElement("div");
    wrap.className = "seq-step";

    // — Delay row —
    const delayRow = document.createElement("div");
    delayRow.className = "seq-delay-row";

    const delayLabel = document.createElement("span");
    delayLabel.className = "seq-delay-label";
    delayLabel.textContent = index === 0 ? "Send after:" : "Then wait:";

    const daysInput = document.createElement("input");
    daysInput.type = "number";
    daysInput.min = "0";
    daysInput.className = "seq-delay-input";
    daysInput.value = String(step.delayDays);
    daysInput.addEventListener("input", () => {
      draftSteps[index].delayDays = Math.max(0, parseInt(daysInput.value, 10) || 0);
      void renderPreview();
    });

    const daysUnit = document.createElement("span");
    daysUnit.className = "seq-delay-unit";
    daysUnit.textContent = "days";

    const hoursInput = document.createElement("input");
    hoursInput.type = "number";
    hoursInput.min = "0";
    hoursInput.max = "23";
    hoursInput.className = "seq-delay-input";
    hoursInput.value = String(step.delayHours);
    hoursInput.addEventListener("input", () => {
      draftSteps[index].delayHours = Math.max(0, Math.min(23, parseInt(hoursInput.value, 10) || 0));
      void renderPreview();
    });

    const hoursUnit = document.createElement("span");
    hoursUnit.className = "seq-delay-unit";
    hoursUnit.textContent = "hours";

    delayRow.appendChild(delayLabel);
    delayRow.appendChild(daysInput);
    delayRow.appendChild(daysUnit);
    delayRow.appendChild(hoursInput);
    delayRow.appendChild(hoursUnit);

    // — Header row —
    const head = document.createElement("div");
    head.className = "seq-step-head";
    const lab = document.createElement("span");
    lab.className = "seq-label";
    lab.textContent = `Message ${index + 1}`;
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "seq-remove";
    rm.textContent = "Remove";
    rm.disabled = draftSteps.length <= 1;
    rm.addEventListener("click", () => {
      if (draftSteps.length <= 1) return;
      draftSteps.splice(index, 1);
      renderSequenceEditor();
      void renderPreview();
    });
    head.appendChild(lab);
    head.appendChild(rm);

    // — Body textarea —
    const ta = document.createElement("textarea");
    ta.className = "seq-body";
    ta.value = step.body;
    ta.placeholder = `Hi _FN_, …`;

    // — Character counter (first step only) —
    let charCounter = null;
    if (index === 0) {
      charCounter = document.createElement("div");
      charCounter.className = "seq-char-count";
      function updateCounter() {
        const len = draftSteps[0].body.length;
        charCounter.textContent = `${len} / 300`;
        charCounter.classList.toggle("seq-char-count-over", len > 300);
      }
      updateCounter();
      ta.addEventListener("input", updateCounter);
    }

    ta.addEventListener("input", () => {
      draftSteps[index].body = ta.value;
      void renderPreview();
    });

    wrap.appendChild(delayRow);
    wrap.appendChild(head);
    wrap.appendChild(ta);
    if (charCounter) wrap.appendChild(charCounter);
    el.sequenceEditor.appendChild(wrap);
  });
}

async function loadCampaignIntoForm(campaignId) {
  const { campaigns } = await loadAll();
  const c = campaigns.find((x) => x.id === campaignId);
  if (!c) return;
  el.campaignName.value = c.name;
  draftSteps = c.messages.length
    ? c.messages.map((m) => ({ body: m.body, delayDays: m.delayDays, delayHours: m.delayHours }))
    : [{ body: "", delayDays: 0, delayHours: 0 }];
  renderSequenceEditor();
}

// ---------------------------------------------------------------------------
// Preview panel
// ---------------------------------------------------------------------------

/** Format a delay as a human-readable string. */
function formatDelay(days, hours) {
  if (days === 0 && hours === 0) return "immediately";
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  return parts.join(" ") + " later";
}

async function refreshPreviewPanel() {
  const campaignId = getSelectedCampaignId();
  if (!campaignId) {
    el.campaignPreview.classList.add("hidden");
    previewContacts = [];
    return;
  }
  previewContacts = await listContactsForCampaign(campaignId);
  if (!previewContacts.length) {
    el.campaignPreview.classList.add("hidden");
    return;
  }
  el.campaignPreview.classList.remove("hidden");

  // Rebuild contact options, preserving the current selection if possible.
  const currentVal = el.previewContactSelect.value;
  el.previewContactSelect.innerHTML = "";
  for (const c of previewContacts) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.fullName;
    el.previewContactSelect.appendChild(opt);
  }
  if (currentVal && previewContacts.some((c) => c.id === currentVal)) {
    el.previewContactSelect.value = currentVal;
  }

  void renderPreview();
}

async function renderPreview() {
  el.previewSteps.innerHTML = "";
  const contactId = el.previewContactSelect.value;
  const contact = previewContacts.find((c) => c.id === contactId);
  if (!contact) return;

  draftSteps.forEach((step, index) => {
    const div = document.createElement("div");
    div.className = "preview-step";

    const labelEl = document.createElement("div");
    labelEl.className = "preview-step-label";
    const timing = document.createElement("span");
    timing.className = "preview-step-timing";
    timing.textContent = `(${formatDelay(step.delayDays, step.delayHours)})`;
    labelEl.textContent = `Step ${index + 1}`;
    labelEl.appendChild(timing);

    const bodyEl = document.createElement("div");
    bodyEl.className = "preview-step-body";
    bodyEl.textContent = replaceFnPlaceholder(step.body, contact.firstName);

    div.appendChild(labelEl);
    div.appendChild(bodyEl);
    el.previewSteps.appendChild(div);
  });
}

el.previewContactSelect.addEventListener("change", () => void renderPreview());

// ---------------------------------------------------------------------------
// Contacts list
// ---------------------------------------------------------------------------

async function renderContactsList() {
  const campaignId = getSelectedCampaignId();
  el.contactsList.innerHTML = "";
  el.contactsPagination.innerHTML = "";
  el.contactsPagination.classList.add("hidden");
  if (campaignId !== lastContactsListCampaignId) {
    contactsListPage = 0;
    lastContactsListCampaignId = campaignId;
  }
  if (!campaignId) {
    el.contactsEmpty.classList.remove("hidden");
    return;
  }
  const { campaigns } = await loadAll();
  const campaign = campaigns.find((c) => c.id === campaignId);
  const contacts = await listContactsForCampaign(campaignId);
  previewContacts = contacts;

  if (!contacts.length) {
    el.contactsEmpty.classList.remove("hidden");
    return;
  }
  el.contactsEmpty.classList.add("hidden");
  const firstStep = campaign && campaign.messages[0];

  const totalPages = Math.max(1, Math.ceil(contacts.length / CONTACTS_PAGE_SIZE));
  if (contactsListPage >= totalPages) contactsListPage = totalPages - 1;
  const start = contactsListPage * CONTACTS_PAGE_SIZE;
  const pageContacts = contacts.slice(start, start + CONTACTS_PAGE_SIZE);

  for (const contact of pageContacts) {
    const li = document.createElement("li");
    li.className = "contact-item";

    const row = document.createElement("div");
    row.className = "contact-item-inner";

    // LinkedIn CDN images require auth cookies and won't load from the
    // extension popup (different origin). Always use initials instead.
    row.appendChild(buildContactAvatarPlaceholder(contact));

    const body = document.createElement("div");
    body.className = "contact-item-body";

    const titleRow = document.createElement("div");
    titleRow.className = "contact-title-row";

    const name = document.createElement("p");
    name.className = "contact-name";
    name.textContent = contact.fullName;

    const primaryBtn = document.createElement("button");
    primaryBtn.type = "button";
    primaryBtn.className = "btn btn-secondary btn-tiny btn-contact-primary";
    const showMessage = contact.isConnected === true;
    primaryBtn.textContent = showMessage ? "Message" : "Connect";
    primaryBtn.title = showMessage
      ? "Open profile to send a message"
      : "Open profile to connect";
    primaryBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: contact.linkedinProfileUrl, active: true });
    });

    // Degree badge (1st / 2nd / 3rd)
    if (contact.connectionDegree && contact.connectionDegree !== "None") {
      const badge = document.createElement("span");
      badge.className = "contact-degree-badge";
      badge.textContent = contact.connectionDegree;
      titleRow.appendChild(badge);
    }

    titleRow.appendChild(primaryBtn);
    body.appendChild(titleRow);
    body.appendChild(name);

    // jobTitle from LinkedIn sometimes starts with the full name — strip it.
    let jobTitle = (contact.jobTitle || "").trim();
    const nameLower = contact.fullName.trim().toLowerCase();
    if (jobTitle.toLowerCase().startsWith(nameLower)) {
      jobTitle = jobTitle.slice(contact.fullName.trim().length).replace(/^\s*[·•\-–—]\s*/, "").trim();
    }
    const company = (contact.company || "").trim();
    if (jobTitle || company) {
      const hl = document.createElement("p");
      hl.className = "contact-headline";
      hl.textContent = [jobTitle, company].filter(Boolean).join(" · ");
      body.appendChild(hl);
    }

    const meta = document.createElement("p");
    meta.className = "contact-meta";
    const a = document.createElement("a");
    a.href = contact.linkedinProfileUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = contact.linkedinProfileUrl;
    meta.appendChild(a);
    body.appendChild(meta);

    if (firstStep && firstStep.body.trim()) {
      const prev = document.createElement("p");
      prev.className = "contact-preview";
      prev.textContent = `Step 1: ${replaceFnPlaceholder(firstStep.body, contact.firstName)}`;
      body.appendChild(prev);
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
      await refreshPreviewPanel();
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
    body.appendChild(actions);

    row.appendChild(body);
    li.appendChild(row);
    el.contactsList.appendChild(li);
  }

  if (contacts.length > CONTACTS_PAGE_SIZE) {
    el.contactsPagination.classList.remove("hidden");
    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "btn btn-secondary btn-tiny";
    prev.textContent = "Previous";
    prev.disabled = contactsListPage <= 0;
    prev.addEventListener("click", () => {
      contactsListPage = Math.max(0, contactsListPage - 1);
      void renderContactsList();
    });
    const label = document.createElement("span");
    label.className = "contacts-page-label";
    label.textContent = `Page ${contactsListPage + 1} of ${totalPages}`;
    const next = document.createElement("button");
    next.type = "button";
    next.className = "btn btn-secondary btn-tiny";
    next.textContent = "Next";
    next.disabled = contactsListPage >= totalPages - 1;
    next.addEventListener("click", () => {
      contactsListPage = Math.min(totalPages - 1, contactsListPage + 1);
      void renderContactsList();
    });
    el.contactsPagination.appendChild(prev);
    el.contactsPagination.appendChild(label);
    el.contactsPagination.appendChild(next);
  }
}

/**
 * @param {{ firstName: string; fullName: string }} contact
 * @returns {HTMLDivElement}
 */
function buildContactAvatarPlaceholder(contact) {
  const div = document.createElement("div");
  div.className = "contact-avatar contact-avatar-placeholder";
  div.setAttribute("aria-hidden", "true");
  div.textContent = contactInitials(contact);
  return div;
}

// ---------------------------------------------------------------------------
// Schedule form (per contact)
// ---------------------------------------------------------------------------

function stepTotalDelayMs(steps, upToIndex) {
  let ms = 0;
  for (let i = 0; i <= upToIndex; i++) {
    ms += ((steps[i]?.delayDays || 0) * 24 + (steps[i]?.delayHours || 0)) * 3600 * 1000;
  }
  return ms;
}

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

  // Step selector (only when there is more than one message)
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

  // Date/time picker — default to now + accumulated step delay
  const timeRow = document.createElement("div");
  timeRow.className = "schedule-row";
  const timeLbl = document.createElement("label");
  timeLbl.className = "label";
  timeLbl.textContent = "Send at";
  const timeInput = document.createElement("input");
  timeInput.type = "datetime-local";
  timeInput.className = "input";

  function updateSuggestedTime() {
    const idx = stepSelect ? parseInt(stepSelect.value, 10) : 0;
    const delayMs = stepTotalDelayMs(campaign.messages, idx);
    timeInput.value = localDatetimeValue(new Date(Date.now() + Math.max(delayMs, 60 * 1000)));
  }
  updateSuggestedTime();
  if (stepSelect) stepSelect.addEventListener("change", updateSuggestedTime);

  timeRow.appendChild(timeLbl);
  timeRow.appendChild(timeInput);
  wrap.appendChild(timeRow);

  // Live preview of the rendered message
  const preview = document.createElement("p");
  preview.className = "schedule-preview";
  function updatePreview() {
    const idx = stepSelect ? parseInt(stepSelect.value, 10) : 0;
    const step = campaign.messages[idx];
    preview.textContent = step ? replaceFnPlaceholder(step.body, contact.firstName) : "";
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
    const step = campaign.messages[stepIndex];
    const finalMessage = replaceFnPlaceholder(step ? step.body : "", contact.firstName);
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

  const active = jobs.filter((j) => !["sent_manually", "cancelled"].includes(j.status));
  if (!active.length) {
    el.queueEmpty.hidden = false;
    return;
  }
  el.queueEmpty.hidden = true;

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

  const info = document.createElement("div");
  info.className = "queue-item-info";

  const nameEl = document.createElement("span");
  nameEl.className = "queue-contact-name";
  nameEl.textContent = contact ? contact.fullName : "(unknown contact)";

  const stepEl = document.createElement("span");
  stepEl.className = "queue-step";
  stepEl.textContent = `${campaign ? campaign.name : "Unknown campaign"} · Step ${job.stepIndex + 1}`;

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

  const actionsEl = document.createElement("div");
  actionsEl.className = "queue-item-actions";

  if (job.status === "drafted") {
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
  await refreshPreviewPanel();
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
  draftSteps = [{ body: "", delayDays: 0, delayHours: 0 }];
  renderSequenceEditor();
  el.campaignPreview.classList.add("hidden");
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
    await refreshPreviewPanel();
    await updateTabHint();
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
  }
});

// ---------------------------------------------------------------------------
// Add message step
// ---------------------------------------------------------------------------

el.btnAddStep.addEventListener("click", () => {
  draftSteps.push({ body: "", delayDays: 1, delayHours: 0 });
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
  const emptyIndex = draftSteps.findIndex((s) => !s.body.trim());
  if (emptyIndex !== -1) {
    setError(`Message ${emptyIndex + 1} is empty.`);
    el.sequenceEditor.querySelectorAll(".seq-body")[emptyIndex]?.focus();
    return;
  }
  if (draftSteps[0].body.length > 300) {
    setError(`Message 1 must be 300 characters or fewer (currently ${draftSteps[0].body.length}).`);
    el.sequenceEditor.querySelectorAll(".seq-body")[0]?.focus();
    return;
  }
  let id = pendingNew ? null : getSelectedCampaignId();
  try {
    if (!id) {
      const c = await createCampaign(name, draftSteps);
      log("popup: created campaign via save", c.id, c.name);
      id = c.id;
      pendingNew = false;
      el.btnNew.disabled = false;
      el.btnClone.disabled = false;
    } else {
      await updateCampaign(id, { name, messages: draftSteps });
      log("popup: saved campaign", id);
    }
    await refreshCampaignSelect(id);
    await renderContactsList();
    await refreshPreviewPanel();
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
    else {
      el.campaignName.value = "";
      draftSteps = [{ body: "", delayDays: 0, delayHours: 0 }];
      renderSequenceEditor();
    }
    await renderContactsList();
    await refreshPreviewPanel();
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
    else {
      el.campaignName.value = "";
      draftSteps = [{ body: "", delayDays: 0, delayHours: 0 }];
      renderSequenceEditor();
    }
    await renderContactsList();
    await refreshPreviewPanel();
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
      photoUrl: profile.photoUrl || undefined,
      isConnected: typeof profile.isConnected === "boolean" ? profile.isConnected : undefined,
      jobTitle: profile.jobTitle || undefined,
      company: profile.company || undefined,
      connectionDegree: profile.connectionDegree || undefined,
    });
    log("popup: contact added", profile.profileUrl, "→ campaign", campaignId);
    await renderContactsList();
    await refreshPreviewPanel();
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
    else {
      el.campaignName.value = "";
      draftSteps = [{ body: "", delayDays: 0, delayHours: 0 }];
      renderSequenceEditor();
    }
    await renderContactsList();
    await refreshPreviewPanel();
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
    else {
      el.campaignName.value = "";
      draftSteps = [{ body: "", delayDays: 0, delayHours: 0 }];
      renderSequenceEditor();
    }
    await renderContactsList();
    await refreshPreviewPanel();
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
