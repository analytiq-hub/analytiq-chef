/**
 * Extract visible name and profile URL from a LinkedIn profile page.
 * Selectors may need updates when LinkedIn changes the DOM.
 */
function buttonLabel(el) {
  return el.textContent.replace(/\s+/g, " ").trim();
}

/**
 * Top-card profile photo URL (if visible).
 * @returns {string|null}
 */
function extractProfilePhotoUrl() {
  const selectors = [
    "img.pv-top-card-profile-picture__image--show",
    "img.pv-top-card-profile-picture__image",
    "img.profile-photo-edit__preview",
  ];
  for (const sel of selectors) {
    const img = document.querySelector(sel);
    if (img && img.src && /^https?:\/\//i.test(img.src)) {
      return img.src.split("?")[0];
    }
  }
  const main = document.querySelector("main");
  if (main) {
    for (const img of main.querySelectorAll('img[src*="licdn.com"], img[src*="licdn"]')) {
      if (img.src && /^https?:\/\//i.test(img.src)) {
        const w = img.naturalWidth || img.width || 0;
        if (w >= 64) return img.src.split("?")[0];
      }
    }
  }
  return null;
}

/**
 * 1st-degree connection shows a primary "Message" button; otherwise "Connect" (or similar).
 * @returns {boolean|null} true = connected, false = not, null = could not tell
 */
function extractConnectionState() {
  const clickable = [...document.querySelectorAll("button, a[role='button']")];
  if (clickable.some((b) => buttonLabel(b) === "Message")) return true;
  if (
    clickable.some((b) => {
      const t = buttonLabel(b);
      return t === "Connect" || t.startsWith("Connect ");
    })
  ) {
    return false;
  }
  return null;
}

function extractProfile() {
  const url = window.location.href.split("?")[0].replace(/\/$/, "");
  let fullName = "";
  const h1 = document.querySelector(
    'h1.text-heading-xlarge, h1.inline.t-24, main h1.text-heading-xlarge, main section h1'
  );
  if (h1) fullName = h1.textContent.replace(/\s+/g, " ").trim();
  if (!fullName) {
    const m = document.title.match(/^(.+?)\s*\|\s*LinkedIn/i);
    if (m) fullName = m[1].trim();
  }
  const firstName = fullName ? fullName.split(/\s+/)[0] : "";
  const photoUrl = extractProfilePhotoUrl();
  const isConnected = extractConnectionState();
  return { firstName, fullName, profileUrl: url, photoUrl, isConnected };
}

log("content: profile script ready", location.pathname);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "GET_PROFILE") {
    const data = extractProfile();
    log("content: GET_PROFILE", data);
    sendResponse(data);
    return true;
  }
  return false;
});
