# Wanderlog Chrome Extension Demo

This is a minimal Manifest V3 Chrome extension that opens Wanderlog's real save panel for a place search and can start a trip with highlighted text as the destination.

## What it does

- Captures the current tab's title and URL.
- Reads the user's current text selection from the page.
- Opens Wanderlog's authenticated save/search panel at `https://extensionembed.wanderlog.com/extension/map`.
- Resolves destination text through `https://app.wanderlog.com/api/geo/autocomplete/...`.
- Opens `https://app.wanderlog.com/plan/create/plan?geoId=...` when a destination match is found.
- Lets Wanderlog handle login, trip selection, and the actual save.
- Adds right-click context menu items for saving a place and adding a destination.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select the `wonderlog-demo-extension` folder.

## Demo flow

1. Open any normal website.
2. Highlight a place name on the page.
3. Open the extension popup.
4. Click **Save place** to open Wanderlog's place-save panel.
5. Click **Add as destination** to open Wanderlog's trip creation page with the destination preselected.

## Where the saved contents go

The real saved place appears wherever you choose inside Wanderlog's panel, usually in the trip or list you select there.

The destination action opens Wanderlog's trip creation flow. The destination is preselected when Wanderlog's geo autocomplete can resolve the text.

The popup's "Recent Wanderlog searches" list is only local history of searches opened from the extension. It is not the source of truth for saved Wanderlog content.

## Why this uses a panel

Wanderlog does not expose a documented public API for saving arbitrary pages directly into a user's account. Its official Chrome extension opens the same extension map panel used here, which keeps login and trip selection inside Wanderlog.
