/**
 * Dev logging: mirrors to console and optionally persists recent lines to
 * chrome.storage.local so the popup can show content-script + popup output together.
 */
const LOG_KEY = "ac_dev_logs";
const SETTINGS_KEY = "ac_settings";
const MAX_LOGS = 200;
const PREFIX = "[Analytiq]";

function formatArgs(args) {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

async function isCaptureEnabled() {
  const raw = await chrome.storage.local.get(SETTINGS_KEY);
  const s = raw[SETTINGS_KEY];
  if (s && typeof s.captureLogs === "boolean") return s.captureLogs;
  return true;
}

/**
 * @param {'log'|'warn'|'error'} level
 * @param {unknown[]} args
 */
async function appendPersisted(level, args) {
  if (!(await isCaptureEnabled())) return;
  const msg = formatArgs(args);
  const raw = await chrome.storage.local.get(LOG_KEY);
  const prev = Array.isArray(raw[LOG_KEY]) ? raw[LOG_KEY] : [];
  const entry = { t: Date.now(), level, msg };
  const next = [...prev, entry].slice(-MAX_LOGS);
  await chrome.storage.local.set({ [LOG_KEY]: next });
}

function emitConsole(level, args) {
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(PREFIX, ...args);
}

async function log(...args) {
  emitConsole("log", args);
  await appendPersisted("log", args);
}

async function warn(...args) {
  emitConsole("warn", args);
  await appendPersisted("warn", args);
}

async function error(...args) {
  emitConsole("error", args);
  await appendPersisted("error", args);
}

/** @returns {Promise<{ t: number; level: string; msg: string }[]>} */
async function getLogs() {
  const raw = await chrome.storage.local.get(LOG_KEY);
  return Array.isArray(raw[LOG_KEY]) ? raw[LOG_KEY] : [];
}

async function clearLogs() {
  await chrome.storage.local.set({ [LOG_KEY]: [] });
}

async function getCaptureLogs() {
  return isCaptureEnabled();
}

async function setCaptureLogs(on) {
  const raw = await chrome.storage.local.get(SETTINGS_KEY);
  const prev = raw[SETTINGS_KEY] && typeof raw[SETTINGS_KEY] === "object" ? raw[SETTINGS_KEY] : {};
  await chrome.storage.local.set({
    [SETTINGS_KEY]: { ...prev, captureLogs: Boolean(on) },
  });
}

/**
 * @param {{ t: number; level: string; msg: string }} e
 */
function formatLogLine(e) {
  const time = new Date(e.t).toISOString();
  return `${time} [${e.level}] ${e.msg}`;
}
