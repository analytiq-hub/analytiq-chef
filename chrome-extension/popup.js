const titleEl = document.getElementById("page-title");
const urlEl = document.getElementById("page-url");
const errorEl = document.getElementById("error");

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

async function main() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      showError("No active tab.");
      return;
    }
    titleEl.textContent = tab.title || "(no title)";
    urlEl.textContent = tab.url || "(no URL)";
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
  }
}

main();
