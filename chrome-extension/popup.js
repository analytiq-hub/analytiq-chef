const PROFILE_URL_RE = /^https:\/\/(www\.)?linkedin\.com\/in\/[^/?#]+\/?/i;

const el = {
  globalError: document.getElementById("global-error"),
  campaignSelect: document.getElementById("campaign-select"),
  campaignName: document.getElementById("campaign-name"),
  sequenceEditor: document.getElementById("sequence-editor"),
  btnNew: document.getElementById("btn-new-campaign"),
  btnAddStep: document.getElementById("btn-add-step"),
  btnSave: document.getElementById("btn-save-campaign"),
  btnDelete: document.getElementById("btn-delete-campaign"),
  currentTabHint: document.getElementById("current-tab-hint"),
  btnAddProfile: document.getElementById("btn-add-profile"),
  contactsList: document.getElementById("contacts-list"),
  contactsEmpty: document.getElementById("contacts-empty"),
};

/** In-memory draft for the sequence while editing (mirrors selected campaign). */
let draftMessages = [""];

function setError(message) {
  if (!message) {
    el.globalError.hidden = true;
    el.globalError.textContent = "";
    return;
  }
  el.globalError.textContent = message;
  el.globalError.hidden = false;
}

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
  el.campaignSelect.disabled = false;
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
    removeBtn.textContent = "Remove from campaign";
    removeBtn.addEventListener("click", async () => {
      if (!confirm(`Remove ${contact.fullName} from this campaign?`)) return;
      await removeContact(contact.id);
      await renderContactsList();
    });
    actions.appendChild(removeBtn);
    li.appendChild(actions);
    el.contactsList.appendChild(li);
  }
}

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

el.campaignSelect.addEventListener("change", async () => {
  setError("");
  const id = getSelectedCampaignId();
  if (id) await loadCampaignIntoForm(id);
  await renderContactsList();
  await updateTabHint();
});

el.btnNew.addEventListener("click", async () => {
  setError("");
  try {
    const c = await createCampaign("New campaign", [""]);
    await refreshCampaignSelect(c.id);
    await loadCampaignIntoForm(c.id);
    await renderContactsList();
    await updateTabHint();
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
  }
});

el.btnAddStep.addEventListener("click", () => {
  draftMessages.push("");
  renderSequenceEditor();
});

el.btnSave.addEventListener("click", async () => {
  setError("");
  const id = getSelectedCampaignId();
  if (!id) {
    setError("Create or select a campaign first.");
    return;
  }
  try {
    await updateCampaign(id, {
      name: el.campaignName.value,
      messages: draftMessages,
    });
    await refreshCampaignSelect(id);
    await renderContactsList();
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
  }
});

el.btnDelete.addEventListener("click", async () => {
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
      draftMessages = [""];
      renderSequenceEditor();
    }
    await renderContactsList();
    await updateTabHint();
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
  }
});

el.btnAddProfile.addEventListener("click", async () => {
  setError("");
  const campaignId = getSelectedCampaignId();
  if (!campaignId) {
    setError("Select a campaign first.");
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !PROFILE_URL_RE.test(tab.url)) {
    setError("Active tab must be a LinkedIn profile (/in/…).");
    return;
  }
  try {
    const profile = await chrome.tabs.sendMessage(tab.id, { type: "GET_PROFILE" });
    if (!profile || !profile.profileUrl) {
      setError("Could not read profile from this page.");
      return;
    }
    await addContactToCampaign(campaignId, {
      linkedinProfileUrl: profile.profileUrl,
      fullName: profile.fullName || "",
      firstName: profile.firstName || "",
    });
    await renderContactsList();
  } catch (e) {
    const msg =
      e && typeof e === "object" && "message" in e
        ? String(/** @type {{ message?: string }} */ (e).message)
        : String(e);
    if (msg.includes("Receiving end does not exist")) {
      setError("Reload the LinkedIn profile tab so the extension can attach, then try again.");
    } else {
      setError(msg);
    }
  }
});

async function init() {
  setError("");
  const first = await refreshCampaignSelect(null);
  if (first) await loadCampaignIntoForm(first);
  else {
    el.campaignName.value = "";
    draftMessages = [""];
    renderSequenceEditor();
  }
  await renderContactsList();
  await updateTabHint();
}

init();
