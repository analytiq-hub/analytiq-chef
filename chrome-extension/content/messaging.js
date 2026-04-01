/**
 * Content script: injected on LinkedIn profile pages (/in/*) and messaging
 * pages (/messaging/*). Handles INSERT_DRAFT messages from the background
 * service worker by finding the message composer and inserting draft text.
 */

/**
 * Poll for a DOM element matching `selector` until it appears or times out.
 * @param {string} selector
 * @param {number} timeoutMs
 * @returns {Promise<Element|null>}
 */
async function waitForElement(selector, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const el = document.querySelector(selector);
    if (el) return el;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

/**
 * On profile pages, find the "Message" button and click it to open the
 * messaging overlay. Retries for up to `timeoutMs` ms in case the button
 * hasn't rendered yet (LinkedIn is a SPA).
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function clickMessageButton(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.replace(/\s+/g, " ").trim() === "Message"
    );
    if (btn) {
      btn.click();
      return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Find the message composer and insert `text` into it.
 * @param {string} text
 * @returns {Promise<{ok: boolean; error?: string}>}
 */
async function insertDraft(text) {
  // Try selectors from most to least specific.
  const selectors = [
    '.msg-form__contenteditable[contenteditable="true"]',
    '.msg-form [contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
  ];

  let composer = null;
  for (const sel of selectors) {
    composer = await waitForElement(sel, 4000);
    if (composer) break;
  }

  if (!composer) return { ok: false, error: "ERR_COMPOSER_NOT_FOUND" };

  composer.focus();
  // execCommand triggers React's synthetic events and works with LinkedIn's
  // contenteditable composer; direct innerHTML assignment does not.
  document.execCommand("selectAll", false, null);
  document.execCommand("insertText", false, text);

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "INSERT_DRAFT") return false;

  (async () => {
    try {
      log("content/messaging: INSERT_DRAFT received", location.pathname);

      if (location.pathname.startsWith("/in/")) {
        // Profile page — click the Message button to open the overlay first.
        const clicked = await clickMessageButton(8000);
        if (!clicked) {
          log("content/messaging: Message button not found");
          sendResponse({ ok: false, error: "ERR_NO_MESSAGE_BUTTON" });
          return;
        }
        // Allow the messaging overlay to animate in.
        await new Promise((r) => setTimeout(r, 1500));
      }

      const result = await insertDraft(msg.text);
      log("content/messaging: insert result", result);
      sendResponse(result);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      error("content/messaging: INSERT_DRAFT failed", err);
      sendResponse({ ok: false, error: err });
    }
  })();

  return true; // keep message channel open for async response
});

log("content/messaging: ready", location.pathname);
