/** @typedef {{ body: string; delayDays: number; delayHours: number }} CampaignStep */
/** @typedef {{ id: string; name: string; messages: CampaignStep[]; createdAt: string; updatedAt: string }} Campaign */
/**
 * @typedef {{
 *   id: string;
 *   campaignId: string;
 *   linkedinProfileUrl: string;
 *   fullName: string;
 *   firstName: string;
 *   createdAt: string;
 *   photoUrl?: string;
 *   isConnected?: boolean;
 *   jobTitle?: string;
 *   company?: string;
 *   connectionDegree?: string;
 * }} CampaignContact
 */

const STORAGE_KEYS = {
  campaigns: "ac_campaigns",
  contacts: "ac_campaign_contacts",
};

/**
 * @param {string|null|undefined} url
 * @returns {boolean}
 */
function isSafeHttpImageUrl(url) {
  if (url == null || typeof url !== "string") return false;
  const t = url.trim();
  if (!t) return false;
  try {
    const u = new URL(t);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Normalize a stored message entry to a CampaignStep.
 * Accepts both the legacy string format and the current object format.
 * @param {string | CampaignStep} raw
 * @returns {CampaignStep}
 */
function normalizeStep(raw) {
  if (typeof raw === "string") return { body: raw, delayDays: 0, delayHours: 0 };
  return {
    body: String(raw.body ?? ""),
    delayDays: Math.max(0, Number(raw.delayDays) || 0),
    delayHours: Math.max(0, Number(raw.delayHours) || 0),
  };
}

/**
 * @param {string} url
 * @returns {string}
 */
function normalizeProfileUrl(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith("linkedin.com")) return url.trim();
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.origin}${path}`;
  } catch {
    return url.trim();
  }
}

/**
 * @returns {Promise<{ campaigns: Campaign[]; contacts: CampaignContact[] }>}
 */
async function loadAll() {
  const raw = await chrome.storage.local.get([STORAGE_KEYS.campaigns, STORAGE_KEYS.contacts]);
  const campaigns = Array.isArray(raw[STORAGE_KEYS.campaigns])
    ? raw[STORAGE_KEYS.campaigns].map((c) => ({
        ...c,
        messages: Array.isArray(c.messages) ? c.messages.map(normalizeStep) : [normalizeStep("")],
      }))
    : [];
  return {
    campaigns,
    contacts: Array.isArray(raw[STORAGE_KEYS.contacts]) ? raw[STORAGE_KEYS.contacts] : [],
  };
}

/**
 * @param {Campaign[]} campaigns
 * @param {CampaignContact[]} contacts
 */
async function saveAll(campaigns, contacts) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.campaigns]: campaigns,
    [STORAGE_KEYS.contacts]: contacts,
  });
}

/**
 * @param {string} name
 * @param {string[]} messages
 * @returns {Promise<Campaign>}
 */
async function createCampaign(name, messages) {
  const { campaigns, contacts } = await loadAll();
  const now = new Date().toISOString();
  const campaign = {
    id: crypto.randomUUID(),
    name: name.trim() || "Untitled campaign",
    messages: messages.length ? messages.map(normalizeStep) : [normalizeStep("")],
    createdAt: now,
    updatedAt: now,
  };
  campaigns.push(campaign);
  await saveAll(campaigns, contacts);
  return campaign;
}

/**
 * @param {string} id
 * @param {Partial<Pick<Campaign, 'name' | 'messages'>>} patch
 */
async function updateCampaign(id, patch) {
  const { campaigns, contacts } = await loadAll();
  const i = campaigns.findIndex((c) => c.id === id);
  if (i === -1) throw new Error("Campaign not found");
  const now = new Date().toISOString();
  if (patch.name != null) campaigns[i].name = patch.name.trim() || "Untitled campaign";
  if (patch.messages != null) campaigns[i].messages = patch.messages.map(normalizeStep);
  campaigns[i].updatedAt = now;
  await saveAll(campaigns, contacts);
  return campaigns[i];
}

/**
 * @param {string} id
 */
async function deleteCampaign(id) {
  const { campaigns, contacts } = await loadAll();
  const nextCampaigns = campaigns.filter((c) => c.id !== id);
  const nextContacts = contacts.filter((c) => c.campaignId !== id);
  await saveAll(nextCampaigns, nextContacts);
}

/**
 * @param {string} campaignId
 * @param {{ linkedinProfileUrl: string; fullName: string; firstName: string; photoUrl?: string|null; isConnected?: boolean|null; jobTitle?: string|null; company?: string|null; connectionDegree?: string|null }} profile
 * @returns {Promise<CampaignContact>}
 */
async function addContactToCampaign(campaignId, profile) {
  const { campaigns, contacts } = await loadAll();
  if (!campaigns.some((c) => c.id === campaignId)) throw new Error("Campaign not found");
  const linkedinProfileUrl = normalizeProfileUrl(profile.linkedinProfileUrl);
  const dup = contacts.some(
    (c) => c.campaignId === campaignId && normalizeProfileUrl(c.linkedinProfileUrl) === linkedinProfileUrl
  );
  if (dup) throw new Error("This profile is already in this campaign.");
  const contact = {
    id: crypto.randomUUID(),
    campaignId,
    linkedinProfileUrl,
    fullName: profile.fullName.trim() || "Unknown",
    firstName: profile.firstName.trim() || profile.fullName.split(/\s+/)[0] || "",
    createdAt: new Date().toISOString(),
  };
  const photo = profile.photoUrl != null ? String(profile.photoUrl).trim() : "";
  if (photo && isSafeHttpImageUrl(photo)) contact.photoUrl = photo;
  if (typeof profile.isConnected === "boolean") contact.isConnected = profile.isConnected;
  const jobTitle = profile.jobTitle != null ? String(profile.jobTitle).trim() : "";
  if (jobTitle) contact.jobTitle = jobTitle;
  const company = profile.company != null ? String(profile.company).trim() : "";
  if (company) contact.company = company;
  const deg = profile.connectionDegree != null ? String(profile.connectionDegree).trim() : "";
  if (deg) contact.connectionDegree = deg;
  contacts.push(contact);
  await saveAll(campaigns, contacts);
  return contact;
}

/**
 * @param {string} campaignId
 * @returns {Promise<CampaignContact[]>}
 */
async function listContactsForCampaign(campaignId) {
  const { contacts } = await loadAll();
  return contacts
    .filter((c) => c.campaignId === campaignId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

/**
 * @param {string} contactId
 */
async function removeContact(contactId) {
  const { campaigns, contacts } = await loadAll();
  const next = contacts.filter((c) => c.id !== contactId);
  await saveAll(campaigns, next);
}

/**
 * @param {string} contactId
 * @returns {Promise<CampaignContact | null>}
 */
async function getContactById(contactId) {
  const { contacts } = await loadAll();
  return contacts.find((c) => c.id === contactId) || null;
}

// ---------------------------------------------------------------------------
// Job queue
// ---------------------------------------------------------------------------

const JOBS_KEY = "ac_jobs";

/**
 * @typedef {'pending'|'opening'|'drafted'|'sent_manually'|'failed'|'cancelled'} JobStatus
 * @typedef {{ id: string; campaignId: string; contactId: string; stepIndex: number; finalMessage: string; scheduledFor: string; status: JobStatus; lastError: string|null; openedTabId: number|null; draftedAt: string|null; sentManuallyAt: string|null; createdAt: string; updatedAt: string }} Job
 */

/** @returns {Promise<Job[]>} */
async function listJobs() {
  const raw = await chrome.storage.local.get(JOBS_KEY);
  return Array.isArray(raw[JOBS_KEY]) ? raw[JOBS_KEY] : [];
}

/**
 * @param {{ campaignId: string; contactId: string; stepIndex: number; finalMessage: string; scheduledFor: string }} data
 * @returns {Promise<Job>}
 */
async function createJob(data) {
  const jobs = await listJobs();
  const now = new Date().toISOString();
  const job = {
    id: crypto.randomUUID(),
    campaignId: data.campaignId,
    contactId: data.contactId,
    stepIndex: data.stepIndex,
    finalMessage: data.finalMessage,
    scheduledFor: data.scheduledFor,
    status: "pending",
    lastError: null,
    openedTabId: null,
    draftedAt: null,
    sentManuallyAt: null,
    createdAt: now,
    updatedAt: now,
  };
  jobs.push(job);
  await chrome.storage.local.set({ [JOBS_KEY]: jobs });
  return job;
}

/**
 * @param {string} id
 * @param {Partial<Job>} patch
 * @returns {Promise<Job>}
 */
async function updateJob(id, patch) {
  const jobs = await listJobs();
  const i = jobs.findIndex((j) => j.id === id);
  if (i === -1) throw new Error("Job not found");
  jobs[i] = { ...jobs[i], ...patch, updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [JOBS_KEY]: jobs });
  return jobs[i];
}

/** @param {string} id */
async function deleteJob(id) {
  const jobs = await listJobs();
  await chrome.storage.local.set({ [JOBS_KEY]: jobs.filter((j) => j.id !== id) });
}
