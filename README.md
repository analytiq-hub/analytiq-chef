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