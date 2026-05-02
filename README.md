<p align="center">
  <img src="assets/wanderlog-notes-banner.png" alt="Wanderlog Notes Clipper promotional banner" />
</p>

# Wanderlog Notes Clipper

[![CI](https://github.com/rosemontni/extension/actions/workflows/ci.yml/badge.svg)](https://github.com/rosemontni/extension/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-green.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-f6a03d.svg)](manifest.json)

Wanderlog Notes Clipper is a Manifest V3 Chrome extension for turning the current page, highlighted destinations, and selected travel text into Wanderlog-ready trip material.

The promotional banner in `assets/wanderlog-notes-banner.png` was generated for this release with GPT Image 2.

![Popup note clipping workflow](docs/screenshots/popup-note-flow.png)

## Features

- Save a place by opening Wanderlog's authenticated save/search panel for the active tab.
- Add highlighted text as a trip destination by resolving it through Wanderlog geo autocomplete, then opening Wanderlog's trip creation flow with the destination selected when possible.
- Right-click selected webpage text and choose **Save selected text to Wanderlog** to create an editable note draft.
- Save selected text clips locally, keep recent trip labels, copy a formatted note, and open Wanderlog for paste or trip organization.
- Preserve source title, source URL, note type, destination/list/day target, and captured timestamp for clipped text.

## Install Locally

1. Download and unzip the latest release asset from [GitHub Releases](https://github.com/rosemontni/extension/releases/latest).
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the unzipped extension folder.

## Selected Text Note Flow

1. Highlight travel advice or a useful detail on a webpage.
2. Right-click and choose **Save selected text to Wanderlog**.
3. Review the editable note preview in the extension popup.
4. Choose a note type, optional trip label, and whether to include the source URL.
5. Click **Save clip** to store the note in Chrome extension storage, or **Copy note** to paste it into Wanderlog.
6. Click **Open Wanderlog** to continue organizing the note in the Wanderlog web app.

## Where Saved Content Goes

Place saves are handed off to Wanderlog's authenticated extension panel. After you choose the trip or list inside Wanderlog, the saved place lives in that Wanderlog destination.

Destination adds open Wanderlog's trip creation page. If Wanderlog autocomplete resolves the selected text, the destination is preselected there.

Selected text clips are stored locally in Chrome extension storage under `wanderlogClips` and can be copied as formatted text for Wanderlog. Wanderlog does not expose a documented public API for writing arbitrary trip notes, so this extension keeps the captured note source of truth local and makes the Wanderlog handoff explicit.

The popup's **Recent activity** list is local extension history. It is useful for quick recall, but Wanderlog remains the source of truth for anything you save through Wanderlog's own UI.

## Development

```bash
npm test
```

The check script validates the Manifest V3 metadata, required files, expected permissions, Wanderlog host permissions, version alignment, and JavaScript syntax.

CI runs the same validation on pushes to `main` and pull requests. The release workflow packages version tags like `v0.2.0` into a ZIP and uploads it to GitHub Releases.

## Release Standard

The durable release checklist lives in [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md). It captures the repo standard that public releases should include complete GitHub About metadata, Apache-2.0 licensing, refreshed README visuals, CI/CD validation, release notes, and a downloadable ZIP asset.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

This project is independent and is not affiliated with, endorsed by, or sponsored by Wanderlog.
