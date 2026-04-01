/**
 * LinkedIn profile parsing for the current page.
 * Primary: parseProfiles() (card anchored on profile-displayphoto images).
 * Fallback: legacy selectors if nothing usable is returned.
 */

function buttonLabel(el) {
  return el.textContent.replace(/\s+/g, " ").trim();
}

/**
 * @param {string} pathname
 * @returns {string}
 */
function inPathVanity(pathname) {
  const m = pathname.replace(/\/+$/, "").match(/\/in\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]).toLowerCase() : "";
}

/**
 * @param {Array<{ profileUrl?: string } | null>} results
 * @returns {object | null}
 */
function pickProfileForCurrentPage(results) {
  const list = results.filter(Boolean);
  if (!list.length) return null;
  const mine = inPathVanity(location.pathname);
  if (mine) {
    const hit = list.find((p) => {
      try {
        if (!p.profileUrl) return false;
        return inPathVanity(new URL(p.profileUrl, location.origin).pathname) === mine;
      } catch {
        return false;
      }
    });
    if (hit) return hit;
  }
  return list[0];
}

/**
 * Parse profile cards from profile-displayphoto images (list views and profile top card).
 * @returns {Array<{
 *   name: string;
 *   profileUrl: string;
 *   image: string;
 *   title: string;
 *   company: string;
 *   isConnected: boolean;
 *   connectionDegree: string;
 * } | null>}
 */
function collectProfileDisplayPhotoImages() {
  const set = new Set();
  for (const sel of [
    'img[src*="profile-displayphoto"]',
    'img[data-delayed-url*="profile-displayphoto"]',
  ]) {
    document.querySelectorAll(sel).forEach((el) => set.add(el));
  }
  return Array.from(set);
}

function parseProfiles() {
  const images = collectProfileDisplayPhotoImages();

  return images
    .map((img) => {
      const card = img.closest('li, [role="listitem"], section, div > div > div');
      if (!card) return null;

      const nameLink = card.querySelector('a[href*="/in/"]');
      const profileUrl = nameLink
        ? nameLink.href.split("?")[0].replace(/\/$/, "")
        : "";
      const name = nameLink ? nameLink.innerText.split("\n")[0].trim() : "";

      const pTags = Array.from(card.querySelectorAll("p")).filter((p) => p.innerText.trim().length > 0);
      const headline = pTags[0] ? pTags[0].innerText.trim() : "";

      const text = card.innerText;
      const is1st = text.includes("· 1st") || text.includes("1st degree");
      const is2nd = text.includes("· 2nd") || text.includes("2nd degree");
      const is3rd = text.includes("· 3rd") || text.includes("3rd degree");

      const degree = is1st ? "1st" : is2nd ? "2nd" : is3rd ? "3rd" : "None";

      let company = pTags[1] ? pTags[1].innerText.trim() : "";
      if ((!company || company.includes("·")) && headline.includes(" at ")) {
        company = headline.split(" at ").pop().trim();
      }

      const imageUrl = resolveProfileImageUrl(img) || "";
      return {
        name: name || headline,
        profileUrl,
        image: imageUrl,
        title: headline,
        company,
        isConnected: is1st,
        connectionDegree: degree,
      };
    })
    .filter((p) => p && (p.name || p.title));
}

/**
 * Top-card profile photo URL (fallback).
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
    const u = resolveProfileImageUrl(img);
    if (u) return u;
  }
  const main = document.querySelector("main");
  if (main) {
    for (const img of main.querySelectorAll('img[src*="licdn.com"], img[src*="licdn"]')) {
      const u = resolveProfileImageUrl(img);
      if (!u) continue;
      const w = img.naturalWidth || img.width || 0;
      if (w >= 64 || w === 0) return u;
    }
  }
  return null;
}

/**
 * @returns {{ jobTitle: string; company: string }}
 */
function extractJobTitleAndCompany() {
  const section =
    document.querySelector("main > section:first-of-type") ||
    document.querySelector(".pv-top-card") ||
    document.querySelector("main section.artdeco-card");
  if (!section) return { jobTitle: "", company: "" };

  const skipLine = (t) => {
    const s = t.replace(/\s+/g, " ").trim();
    if (!s || s.length > 220) return true;
    if (/^https?:\/\//i.test(s)) return true;
    if (/connections?$|followers?|mutual|following|contact info|show all/i.test(s)) return true;
    if (/^\d+\+?\s*connections/i.test(s)) return true;
    if (looksLikeLocationLine(s)) return true;
    return false;
  };

  const pushUniq = (arr, raw) => {
    const s = raw.replace(/\s+/g, " ").trim();
    if (skipLine(s)) return;
    if (!arr.includes(s)) arr.push(s);
  };

  const mediums = [];
  for (const el of section.querySelectorAll("div.text-body-medium")) {
    pushUniq(mediums, el.textContent || "");
  }

  if (mediums.length >= 2) {
    return { jobTitle: mediums[0], company: mediums[1] };
  }
  if (mediums.length === 1) {
    const t = mediums[0];
    const at = t.match(/^(.+?)\s+at\s+(.+)$/i);
    if (at) return { jobTitle: at[1].trim(), company: at[2].trim() };
    const mid = t.match(/^(.+?)\s*[·•]\s*(.+)$/);
    if (mid && mid[1].length < 120 && mid[2].length < 120 && !looksLikeLocationLine(mid[2])) {
      return { jobTitle: mid[1].trim(), company: mid[2].trim() };
    }
    return { jobTitle: t, company: "" };
  }

  const fallback = [];
  for (const el of section.querySelectorAll("div.text-body-small, div.text-body-large")) {
    pushUniq(fallback, el.textContent || "");
  }
  if (fallback.length >= 2) return { jobTitle: fallback[0], company: fallback[1] };
  if (fallback.length === 1) {
    const t = fallback[0];
    const at = t.match(/^(.+?)\s+at\s+(.+)$/i);
    if (at) return { jobTitle: at[1].trim(), company: at[2].trim() };
    return { jobTitle: t, company: "" };
  }
  return { jobTitle: "", company: "" };
}

/**
 * @param {string} s
 * @returns {boolean}
 */
function looksLikeLocationLine(s) {
  if (/,/.test(s) && /\b(United States|USA|U\.S\.|UK|India|Canada|Australia|Germany|France)\b/i.test(s)) {
    return true;
  }
  if (/^[A-Za-z\s,.-]+,\s*[A-Z]{2}\s*,/.test(s)) return true;
  return false;
}

/**
 * @returns {boolean|null}
 */
function extractConnectionState() {
  const clickable = [...document.querySelectorAll("button, a[role='button']")];
  if (clickable.some((b) => buttonLabel(b) === "Message")) return true;

  const badge =
    document.querySelector(".distance-badge .dist-value") ||
    document.querySelector(".dist-value") ||
    document.querySelector('[class*="distance-badge"] span');
  const badgeText = badge ? badge.textContent : "";
  if (badgeText && /\b1st\b/i.test(badgeText)) return true;

  const topCard = document.querySelector("main section:first-of-type, .pv-top-card, main section.artdeco-card");
  if (topCard && /·\s*1st\b/i.test(topCard.textContent)) return true;

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

  const parsed = parseProfiles();
  const picked = pickProfileForCurrentPage(parsed);

  if (picked && (picked.image || picked.name || picked.title)) {
    const fullName = String(picked.name || "").trim() || "Unknown";
    const firstName = fullName ? fullName.split(/\s+/)[0] : "";
    const jobTitle = String(picked.title || "").trim();
    const company = String(picked.company || "").trim();
    const photoUrl =
      picked.image && isHttpImageUrl(picked.image) ? picked.image.trim() : null;
    return {
      firstName,
      fullName,
      profileUrl: url,
      photoUrl,
      isConnected: picked.isConnected === true,
      jobTitle,
      company,
      connectionDegree: picked.connectionDegree || undefined,
    };
  }

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
  let isConnected = extractConnectionState();
  const { jobTitle, company } = extractJobTitleAndCompany();
  if (typeof isConnected !== "boolean" && (jobTitle || company)) {
    const topCard = document.querySelector("main section:first-of-type, .pv-top-card, main section.artdeco-card");
    if (topCard && (/·\s*1st\b/i.test(topCard.textContent) || /1st\s+degree/i.test(topCard.textContent))) {
      isConnected = true;
    }
  }
  return {
    firstName,
    fullName: fullName || "Unknown",
    profileUrl: url,
    photoUrl,
    isConnected,
    jobTitle,
    company,
    connectionDegree: undefined,
  };
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
