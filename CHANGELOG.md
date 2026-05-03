# Changelog

## v0.6.1 - 2026-05-02

- Fixed the selected-text note **Load trips** action more thoroughly by supporting additional Wanderlog trip route shapes (`/plan`, `/view`, query-string trip IDs) and trip field names (`planId`, `planName`, `displayName`).
- Added a direct authenticated trip API fallback from the service worker with short timeouts, so Reload can still do useful work when the Wanderlog page bridge has not populated cache yet.
- Added a browser-level popup smoke test that loads the unpacked extension in Chromium, opens a mocked Wanderlog trip page, clicks the real **Load trips** button, and verifies the **Send to trip** dropdown is populated.
- Ignored disposable browser test profiles generated during local verification.

## v0.6.0 - 2026-05-02

- Fixed selected-text note trip loading by adding a page-context bridge that can read Wanderlog's live app state and fetch activity from `app.wanderlog.com`.
- Improved Reload reliability for trip selectors with short background retries, manual bridge injection, and a stale-cache fallback when the Wanderlog tab is still hydrating.
- Added bridge coverage to `npm test` and included `wanderlog-page-bridge.js` in release ZIP packaging.
- Refreshed public-facing README and GitHub About metadata to describe direct trip writes, privacy behavior, and the current clipper workflow.

## v0.5.0 - 2026-05-02

- Removed Save locally from both the clip card and bulk importer — it stored data with no follow-up action and has been replaced by Send to Wanderlog as the primary path and Copy as the manual fallback.
- Fixed trip loading: the fetch interceptor now clones successful GET responses to cache actual trip data, and the page script scrapes trip links from Wanderlog's sidebar DOM on load. Trips no longer require guessing undocumented API endpoints.
- Fixed trip selects staying stuck on "loading trips…" when loading fails — selects now show an actionable error placeholder and the status text is always updated.
- Fixed `importTripSelect` not being re-enabled after a failed load.
- Sent imports are now recorded in Recent activity (previously only clips were).
- Added Prerequisites for Direct Write section to README with a feature table clarifying which actions require visiting app.wanderlog.com first.
- Corrected README claim that the extension opens a Wanderlog tab automatically when none is present.

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
