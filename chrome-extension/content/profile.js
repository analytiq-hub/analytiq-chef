/**
 * Extract visible name and profile URL from a LinkedIn profile page.
 * Selectors may need updates when LinkedIn changes the DOM.
 */
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
  return { firstName, fullName, profileUrl: url };
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
