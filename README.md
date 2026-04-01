# analytiq-chef

## Chrome extension

The extension lives in `chrome-extension/`. Load it in developer mode so Chrome reads the files directly from this repo.

### Load the extension (first time)

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the `chrome-extension` directory (the folder that contains `manifest.json`).

You should see **Analytiq Chef** in the list. Pin it from the extensions menu if you want the icon in the toolbar.

### Reload after you change code

Whenever you edit `manifest.json`, popup files, content scripts, or anything else under `chrome-extension/`:

1. Go to `chrome://extensions`.
2. Find **Analytiq Chef** and click **Reload** (circular arrow icon).

Then refresh behavior:

- After changes to **content scripts** (files under `chrome-extension/content/`), **reload open LinkedIn tabs** (or close and reopen them) so the updated script is injected.
- After **permission or manifest** changes, reloading the extension from `chrome://extensions` is required; Chrome will use the new manifest on the next load.

### Development logs

Open the extension popup and expand **Development logs**. Recent lines from the **popup** and from **LinkedIn profile pages** (content script) are saved when **Save logs** is checked (default on): same buffer, so you can iterate without juggling separate DevTools consoles. Use **Refresh**, **Copy all**, or **Clear** as needed. Logs also print to the browser console with the prefix `[Analytiq]` when you inspect the popup or the page.

### Error: `Cannot read properties of undefined (reading 'local')`

That means `chrome.storage` is missing. In Chrome, **`chrome.storage` only exists in an extension context** and requires the **`storage` permission** in `manifest.json` (this project includes it).

Typical causes:

1. **Opening `popup.html` directly** (file URL or a normal browser tab) — use **Load unpacked** on `chrome://extensions` and open the UI from the **extension icon**, not by double‑clicking the HTML file.
2. **Extension not reloaded** after changing `manifest.json` — click **Reload** on the extension card on `chrome://extensions`.