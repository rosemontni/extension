# Changelog

## v0.4.0 - 2026-05-02

- Added direct write to Wanderlog trips: notes and bulk destination lists are now sent straight into a selected trip without any copy-paste handoff.
- Added `wanderlog-app.js` content script on `app.wanderlog.com` that intercepts the Wanderlog web app's own fetch calls to discover internal API endpoints, stores discovered patterns locally, and proxies authenticated same-origin write requests from the extension.
- Added trip selector dropdowns (clip card and bulk importer) that auto-populate when the popup opens by fetching the user's trips from Wanderlog.
- Added **Send to Wanderlog** as the primary action for both note clips and bulk destination imports; **Save locally** and **Copy** remain available as fallbacks.
- Bulk destination importer now sends all previewed places to the selected trip's places in one click, without requiring a prior geo match check.
- Background service worker gains `GET_WANDERLOG_TRIPS`, `WANDERLOG_SEND_CLIP`, and `WANDERLOG_SEND_DESTINATIONS` message handlers with a content script proxy fallback.

## v0.3.0 - 2026-05-02

- Added a bulk destination-list importer with one-place-per-line parsing, bullet/number cleanup, preview, remove/uncheck controls, duplicate warnings, and local import storage.
- Added Wanderlog autocomplete match checking for prepared destination imports.
- Added formatted copy output for manual Wanderlog import handoff.
- Moved shared note/import formatting and parsing logic into a tested utility module.

## v0.2.0 - 2026-05-02

- Added a right-click "Save selected text to Wanderlog" flow for highlighted webpage text.
- Added editable note previews with note type, trip label, destination/list/day target, source URL inclusion, local saving, and copy-to-clipboard formatting.
- Added the "Add as destination" action that resolves highlighted text through Wanderlog autocomplete and opens Wanderlog's trip creation flow with the destination selected when possible.
- Added Apache-2.0 licensing, README visuals, release checklist documentation, CI validation, and tag-based release packaging.

## v0.1.0 - 2026-05-02

- Initial Manifest V3 demo extension for opening Wanderlog's save panel from the active browser tab.
