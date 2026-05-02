import {
  MAX_CLIP_TEXT_LENGTH,
  MAX_IMPORT_DESTINATIONS,
  buildDestinationImportText,
  escapeHtml,
  formatClipNote,
  getImportCounts,
  normalizeClipText,
  parseDestinationList,
  truncate
} from "./lib/wanderlog-utils.js";

const STORAGE_KEY = "wanderlogSearches";
const CLIPS_STORAGE_KEY = "wanderlogClips";
const IMPORTS_STORAGE_KEY = "wanderlogDestinationImports";
const PENDING_CLIP_KEY = "wanderlogPendingClip";
const RECENT_TRIPS_KEY = "wanderlogRecentTripLabels";

const entryList = document.getElementById("entry-list");
const entryCount = document.getElementById("entry-count");
const searchInput = document.getElementById("search-input");
const pageTitle = document.getElementById("page-title");
const pageUrl = document.getElementById("page-url");
const selectionBox = document.getElementById("selection-box");
const saveButton = document.getElementById("save-button");
const destinationButton = document.getElementById("destination-button");
const statusText = document.getElementById("status-text");

const clipCard = document.getElementById("clip-card");
const clipText = document.getElementById("clip-text");
const clipLength = document.getElementById("clip-length");
const clipSourceTitle = document.getElementById("clip-source-title");
const clipSourceUrl = document.getElementById("clip-source-url");
const clipTripInput = document.getElementById("clip-trip-input");
const clipNoteType = document.getElementById("clip-note-type");
const clipDestinationType = document.getElementById("clip-destination-type");
const clipTargetInput = document.getElementById("clip-target-input");
const clipIncludeSource = document.getElementById("clip-include-source");
const recentTripList = document.getElementById("recent-trip-list");
const saveClipButton = document.getElementById("save-clip-button");
const copyNoteButton = document.getElementById("copy-note-button");
const openWanderlogButton = document.getElementById("open-wanderlog-button");
const cancelClipButton = document.getElementById("cancel-clip-button");
const clipStatusText = document.getElementById("clip-status-text");

const importText = document.getElementById("import-text");
const importCount = document.getElementById("import-count");
const importTripInput = document.getElementById("import-trip-input");
const importTargetType = document.getElementById("import-target-type");
const importTargetInput = document.getElementById("import-target-input");
const parseImportButton = document.getElementById("parse-import-button");
const checkImportButton = document.getElementById("check-import-button");
const saveImportButton = document.getElementById("save-import-button");
const copyImportButton = document.getElementById("copy-import-button");
const openImportWanderlogButton = document.getElementById("open-import-wanderlog-button");
const clearImportButton = document.getElementById("clear-import-button");
const importStatusText = document.getElementById("import-status-text");
const importList = document.getElementById("import-list");

let currentContext = {
  title: "Untitled page",
  url: "",
  selection: ""
};
let currentClip = null;
let importItems = [];
let recentImportedDestinations = [];

init().catch((error) => {
  setStatus("Could not read the active tab.");
  console.error(error);
});

saveButton.addEventListener("click", () => {
  openWanderlog("place");
});

destinationButton.addEventListener("click", () => {
  openWanderlog("destination");
});

clipText.addEventListener("input", () => {
  updateClipLength();
});

saveClipButton.addEventListener("click", () => {
  saveClipLocally();
});

copyNoteButton.addEventListener("click", () => {
  copyFormattedNote();
});

openWanderlogButton.addEventListener("click", () => {
  openWanderlogApp();
});

cancelClipButton.addEventListener("click", async () => {
  await chrome.storage.local.remove(PENDING_CLIP_KEY);
  currentClip = null;
  clipCard.classList.add("hidden");
  renderEntries(await getEntries());
});

parseImportButton.addEventListener("click", () => {
  parseImportPreview();
});

checkImportButton.addEventListener("click", () => {
  checkImportMatches();
});

saveImportButton.addEventListener("click", () => {
  saveDestinationImport();
});

copyImportButton.addEventListener("click", () => {
  copyDestinationImport();
});

openImportWanderlogButton.addEventListener("click", () => {
  openWanderlogApp();
});

clearImportButton.addEventListener("click", () => {
  importText.value = "";
  importItems = [];
  renderImportPreview();
  importStatusText.textContent = "Import cleared.";
});

importList.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-import-toggle]");
  if (!checkbox) {
    return;
  }

  const item = findImportItem(checkbox.dataset.importToggle);
  if (!item) {
    return;
  }

  item.included = checkbox.checked;
  renderImportPreview();
});

importList.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-import]");
  if (!removeButton) {
    return;
  }

  importItems = importItems.filter((item) => item.id !== removeButton.dataset.removeImport);
  renderImportPreview();
});

async function openWanderlog(kind) {
  const search = searchInput.value.trim();
  if (!search) {
    setStatus("Enter or highlight a place or destination first.");
    return;
  }

  setButtonsDisabled(true);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const type =
      kind === "destination" ? "OPEN_WANDERLOG_DESTINATION" : "OPEN_WANDERLOG_FOR_TAB";
    const response = await chrome.runtime.sendMessage({
      type,
      tabId: tab?.id,
      search,
      sourceUrl: currentContext.url
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Unable to open Wanderlog.");
    }

    setStatus(getSuccessMessage(kind, response.result));
    renderEntries(await getEntries());
  } catch (error) {
    setStatus(error.message || "Could not open Wanderlog.");
    console.error(error);
  } finally {
    setButtonsDisabled(false);
  }
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentContext = await getPageContext(tab);
  recentImportedDestinations = await getRecentImportedDestinations();
  renderContext(currentContext);
  searchInput.value = currentContext.selection || currentContext.title || "";
  await loadPendingClip();
  renderImportPreview();
  renderEntries(await getEntries());
}

async function getPageContext(tab) {
  const fallback = {
    title: tab?.title || "Untitled page",
    url: tab?.url || "",
    selection: ""
  };

  if (!tab?.id || !tab.url || tab.url.startsWith("chrome://")) {
    return fallback;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_CONTEXT" });
    return {
      title: response?.title || fallback.title,
      url: response?.url || fallback.url,
      selection: response?.selection || ""
    };
  } catch (_error) {
    return fallback;
  }
}

async function loadPendingClip() {
  const data = await chrome.storage.local.get([PENDING_CLIP_KEY, RECENT_TRIPS_KEY]);
  renderRecentTrips(Array.isArray(data[RECENT_TRIPS_KEY]) ? data[RECENT_TRIPS_KEY] : []);

  if (!data[PENDING_CLIP_KEY]) {
    clipCard.classList.add("hidden");
    return;
  }

  currentClip = data[PENDING_CLIP_KEY];
  renderClip(currentClip);
}

async function getEntries() {
  const data = await chrome.storage.local.get([STORAGE_KEY, CLIPS_STORAGE_KEY, IMPORTS_STORAGE_KEY]);
  const searches = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
  const clips = Array.isArray(data[CLIPS_STORAGE_KEY]) ? data[CLIPS_STORAGE_KEY] : [];
  const imports = Array.isArray(data[IMPORTS_STORAGE_KEY]) ? data[IMPORTS_STORAGE_KEY] : [];

  return [
    ...searches.map((entry) => ({
      ...entry,
      activityType: "search",
      activityAt: entry.openedAt
    })),
    ...clips.map((entry) => ({
      ...entry,
      activityType: "clip",
      activityAt: entry.savedAt || entry.capturedAt
    })),
    ...imports.map((entry) => ({
      ...entry,
      activityType: "import",
      activityAt: entry.savedAt || entry.preparedAt
    }))
  ].sort((left, right) => new Date(right.activityAt) - new Date(left.activityAt));
}

function renderContext(context) {
  pageTitle.textContent = context.title;
  pageUrl.textContent = context.url || "This page cannot be read.";
  pageUrl.href = context.url || "#";

  if (context.selection) {
    selectionBox.textContent = context.selection;
    selectionBox.classList.remove("empty");
  } else {
    selectionBox.textContent = "No highlighted text yet.";
    selectionBox.classList.add("empty");
  }
}

function renderClip(clip) {
  clipCard.classList.remove("hidden");
  clipText.value = clip.selectedText || "";
  clipSourceTitle.textContent = clip.sourceTitle || "Untitled page";
  clipSourceUrl.textContent = clip.sourceUrl || "No source URL available.";
  clipSourceUrl.href = clip.sourceUrl || "#";
  clipIncludeSource.checked = true;
  clipStatusText.textContent = "Review the note, then save locally or copy it for Wanderlog.";
  updateClipLength();
}

function renderRecentTrips(trips) {
  recentTripList.innerHTML = trips
    .slice(0, 10)
    .map((trip) => `<option value="${escapeHtml(trip)}"></option>`)
    .join("");
}

function renderEntries(entries) {
  entryCount.textContent = String(entries.length);

  if (!entries.length) {
    entryList.innerHTML = "<li class=\"entry-item\"><p>No Wanderlog activity yet.</p></li>";
    return;
  }

  entryList.innerHTML = entries
    .slice(0, 6)
    .map((entry) => {
      if (entry.activityType === "clip") {
        return renderClipEntry(entry);
      }

      if (entry.activityType === "import") {
        return renderImportEntry(entry);
      }

      return `
        <li class="entry-item">
          <h3>${escapeHtml(truncate(entry.search, 70))}</h3>
          <p>${escapeHtml(entry.kind === "destination" ? "Destination" : "Place")}</p>
          ${entry.matchedName ? `<p>${escapeHtml(truncate(entry.matchedName, 90))}</p>` : ""}
          <p>${escapeHtml(new Date(entry.activityAt).toLocaleString())}</p>
        </li>
      `;
    })
    .join("");
}

function renderClipEntry(entry) {
  const destination = entry.destinationLabel
    ? `${entry.destinationType}: ${entry.destinationLabel}`
    : entry.destinationType;

  return `
    <li class="entry-item">
      <h3>${escapeHtml(truncate(entry.selectedText, 70))}</h3>
      <p>Saved note | ${escapeHtml(entry.noteType)}</p>
      ${entry.tripLabel ? `<p>Trip: ${escapeHtml(entry.tripLabel)}</p>` : ""}
      <p>${escapeHtml(destination)}</p>
      <p>${escapeHtml(new Date(entry.activityAt).toLocaleString())}</p>
    </li>
  `;
}

function renderImportEntry(entry) {
  const counts = getImportCounts(entry.items || []);
  const target = entry.targetLabel ? `${entry.targetType}: ${entry.targetLabel}` : entry.targetType;

  return `
    <li class="entry-item">
      <h3>Destination import: ${counts.usable} places</h3>
      ${entry.tripLabel ? `<p>Trip: ${escapeHtml(entry.tripLabel)}</p>` : ""}
      <p>${escapeHtml(target)} | ${counts.matched} matched, ${counts.duplicates} duplicates</p>
      <p>${escapeHtml(new Date(entry.activityAt).toLocaleString())}</p>
    </li>
  `;
}

async function saveClipLocally() {
  try {
    const clip = buildClipFromForm();
    const data = await chrome.storage.local.get([CLIPS_STORAGE_KEY, RECENT_TRIPS_KEY]);
    const clips = Array.isArray(data[CLIPS_STORAGE_KEY]) ? data[CLIPS_STORAGE_KEY] : [];
    const recentTrips = Array.isArray(data[RECENT_TRIPS_KEY]) ? data[RECENT_TRIPS_KEY] : [];

    const nextClips = [clip, ...clips].slice(0, 100);
    const nextTrips = addRecentTrip(recentTrips, clip.tripLabel);

    await chrome.storage.local.set({
      [CLIPS_STORAGE_KEY]: nextClips,
      [RECENT_TRIPS_KEY]: nextTrips
    });
    await chrome.storage.local.remove(PENDING_CLIP_KEY);

    currentClip = clip;
    renderRecentTrips(nextTrips);
    clipStatusText.textContent = "Clip saved locally. Use Copy note to paste it into Wanderlog.";
    renderEntries(await getEntries());
  } catch (error) {
    clipStatusText.textContent = error.message || "Could not save clip.";
  }
}

async function copyFormattedNote() {
  try {
    const clip = buildClipFromForm();
    await copyTextToClipboard(clip.formattedNote);
    clipStatusText.textContent = "Formatted note copied.";
  } catch (error) {
    clipStatusText.textContent = error.message || "Could not copy note.";
  }
}

function buildClipFromForm() {
  if (!currentClip) {
    throw new Error("No selected text clip is ready.");
  }

  const selectedText = normalizeClipText(clipText.value);
  if (!selectedText) {
    throw new Error("Selected text cannot be empty.");
  }

  if (selectedText.length > MAX_CLIP_TEXT_LENGTH) {
    throw new Error(`Keep clips under ${MAX_CLIP_TEXT_LENGTH} characters.`);
  }

  const clip = {
    ...currentClip,
    selectedText,
    noteType: clipNoteType.value,
    destinationType: clipDestinationType.value,
    destinationLabel: clipTargetInput.value.trim(),
    tripLabel: clipTripInput.value.trim(),
    includeSourceUrl: clipIncludeSource.checked,
    savedAt: new Date().toISOString(),
    status: "saved"
  };

  return {
    ...clip,
    formattedNote: formatClipNote(clip)
  };
}

async function parseImportPreview() {
  const parsed = parseDestinationList(importText.value, {
    existingDestinations: recentImportedDestinations,
    maxItems: MAX_IMPORT_DESTINATIONS
  });

  importItems = parsed.items.map((item, index) => ({
    ...item,
    id: `${Date.now()}-${index}`,
    included: item.status !== "duplicate"
  }));

  renderImportPreview();

  if (!importItems.length) {
    importStatusText.textContent = "Paste one destination per line to preview an import.";
  } else if (parsed.truncatedCount) {
    importStatusText.textContent =
      `Previewing the first ${MAX_IMPORT_DESTINATIONS} destinations. ` +
      `${parsed.truncatedCount} extra entries were skipped.`;
  } else {
    const counts = getImportCounts(importItems);
    importStatusText.textContent =
      `Preview ready: ${counts.usable} usable, ${counts.duplicates} duplicates.`;
  }
}

function renderImportPreview() {
  const counts = getImportCounts(importItems);
  importCount.textContent = `${counts.usable}/${counts.total}`;
  checkImportButton.disabled = counts.usable === 0;
  saveImportButton.disabled = counts.usable === 0;
  copyImportButton.disabled = counts.usable === 0;

  if (!importItems.length) {
    importList.innerHTML = "<li class=\"import-empty\">No destination preview yet.</li>";
    return;
  }

  importList.innerHTML = importItems
    .map((item) => {
      const checked = item.included !== false ? "checked" : "";
      const disabled = item.status === "duplicate" ? "disabled" : "";
      const meta = getImportItemMeta(item);

      return `
        <li class="import-item ${escapeHtml(item.status)}">
          <div class="import-item-header">
            <label class="import-toggle">
              <input
                type="checkbox"
                data-import-toggle="${escapeHtml(item.id)}"
                ${checked}
                ${disabled}
              />
              <span class="import-name">${escapeHtml(item.name)}</span>
            </label>
            <span class="status-pill ${escapeHtml(item.status)}">${escapeHtml(getImportStatusLabel(item))}</span>
          </div>
          ${meta ? `<p class="import-meta">${escapeHtml(meta)}</p>` : ""}
          <button class="link-button" type="button" data-remove-import="${escapeHtml(item.id)}">
            Remove
          </button>
        </li>
      `;
    })
    .join("");
}

async function checkImportMatches() {
  if (!importItems.length) {
    await parseImportPreview();
  }

  const candidates = importItems.filter(
    (item) => item.included !== false && item.status !== "duplicate"
  );

  if (!candidates.length) {
    importStatusText.textContent = "No usable destinations to check.";
    return;
  }

  setImportButtonsDisabled(true);

  try {
    for (const item of candidates) {
      item.status = "checking";
      renderImportPreview();
      importStatusText.textContent = `Checking ${item.name}...`;

      try {
        const response = await chrome.runtime.sendMessage({
          type: "RESOLVE_WANDERLOG_DESTINATION",
          search: item.name
        });

        if (!response?.ok) {
          throw new Error(response?.error || "No match response.");
        }

        if (response.result?.matchedName) {
          item.status = "matched";
          item.matchedName = response.result.matchedName;
          item.geoId = response.result.geoId;
          item.createUrl = response.result.createUrl;
        } else {
          item.status = "unmatched";
          item.matchedName = "";
        }
      } catch (error) {
        item.status = "failed";
        item.error = error.message || "Could not check match.";
      }
    }

    const counts = getImportCounts(importItems);
    importStatusText.textContent =
      `Match check done: ${counts.matched} matched, ${counts.unmatched} unmatched, ` +
      `${counts.failed} failed.`;
  } finally {
    setImportButtonsDisabled(false);
    renderImportPreview();
  }
}

async function saveDestinationImport() {
  try {
    const session = buildDestinationImportSession();
    const data = await chrome.storage.local.get([IMPORTS_STORAGE_KEY, RECENT_TRIPS_KEY]);
    const imports = Array.isArray(data[IMPORTS_STORAGE_KEY]) ? data[IMPORTS_STORAGE_KEY] : [];
    const recentTrips = Array.isArray(data[RECENT_TRIPS_KEY]) ? data[RECENT_TRIPS_KEY] : [];
    const nextTrips = addRecentTrip(recentTrips, session.tripLabel);

    await chrome.storage.local.set({
      [IMPORTS_STORAGE_KEY]: [session, ...imports].slice(0, 25),
      [RECENT_TRIPS_KEY]: nextTrips
    });

    recentImportedDestinations = await getRecentImportedDestinations();
    renderRecentTrips(nextTrips);
    importStatusText.textContent =
      "Import saved locally. Copy the list or open Wanderlog to add it manually.";
    renderEntries(await getEntries());
  } catch (error) {
    importStatusText.textContent = error.message || "Could not save import.";
  }
}

async function copyDestinationImport() {
  try {
    const session = buildDestinationImportSession();
    await copyTextToClipboard(buildDestinationImportText(session));
    importStatusText.textContent = "Destination import copied.";
  } catch (error) {
    importStatusText.textContent = error.message || "Could not copy destination import.";
  }
}

function buildDestinationImportSession() {
  const usableItems = importItems.filter(
    (item) => item.included !== false && item.status !== "duplicate"
  );

  if (!usableItems.length) {
    throw new Error("Preview at least one usable destination first.");
  }

  return {
    id: crypto.randomUUID(),
    tripLabel: importTripInput.value.trim(),
    targetType: importTargetType.value,
    targetLabel: importTargetInput.value.trim(),
    sourceTitle: currentContext.title,
    sourceUrl: currentContext.url,
    preparedAt: new Date().toISOString(),
    savedAt: new Date().toISOString(),
    status: "prepared",
    items: importItems.map((item) => ({ ...item }))
  };
}

async function getRecentImportedDestinations() {
  const data = await chrome.storage.local.get(IMPORTS_STORAGE_KEY);
  const imports = Array.isArray(data[IMPORTS_STORAGE_KEY]) ? data[IMPORTS_STORAGE_KEY] : [];

  return imports
    .flatMap((entry) => entry.items || [])
    .filter((item) => item.status !== "duplicate")
    .map((item) => item.name)
    .slice(0, 200);
}

function findImportItem(id) {
  return importItems.find((item) => item.id === id);
}

function getImportStatusLabel(item) {
  const labels = {
    ready: "Ready",
    duplicate: "Duplicate",
    checking: "Checking",
    matched: "Matched",
    unmatched: "No match",
    failed: "Failed"
  };

  return labels[item.status] || "Ready";
}

function getImportItemMeta(item) {
  if (item.status === "duplicate") {
    return item.duplicateReason;
  }

  if (item.status === "matched") {
    return item.matchedName ? `Wanderlog match: ${item.matchedName}` : "Matched in Wanderlog";
  }

  if (item.status === "unmatched") {
    return "No Wanderlog geo match found; keep it for manual import.";
  }

  if (item.status === "failed") {
    return item.error || "Could not check this destination.";
  }

  return `Line ${item.lineNumber}`;
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch (_error) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const copied = document.execCommand("copy");
    textArea.remove();

    if (!copied) {
      throw new Error("Could not access the clipboard.");
    }
  }
}

function updateClipLength() {
  const length = normalizeClipText(clipText.value).length;
  clipLength.textContent = `${length}/${MAX_CLIP_TEXT_LENGTH}`;
  if (length > MAX_CLIP_TEXT_LENGTH) {
    clipStatusText.textContent = `Keep clips under ${MAX_CLIP_TEXT_LENGTH} characters.`;
  }
}

function addRecentTrip(trips, tripLabel) {
  if (!tripLabel) {
    return trips;
  }

  return [tripLabel, ...trips.filter((trip) => trip !== tripLabel)].slice(0, 10);
}

function setStatus(message) {
  statusText.textContent = message;
}

function setButtonsDisabled(disabled) {
  saveButton.disabled = disabled;
  destinationButton.disabled = disabled;
}

function setImportButtonsDisabled(disabled) {
  parseImportButton.disabled = disabled;
  checkImportButton.disabled = disabled;
  saveImportButton.disabled = disabled;
  copyImportButton.disabled = disabled;
}

function getSuccessMessage(kind, result) {
  if (kind === "destination") {
    if (result?.matchedName) {
      return `Opened trip creation for ${result.matchedName}.`;
    }

    return "Opened Wanderlog trip creation.";
  }

  return result?.mode === "tab"
    ? "Opened Wanderlog in a tab."
    : "Opened Wanderlog on this page.";
}

function openWanderlogApp() {
  chrome.tabs.create({ url: "https://app.wanderlog.com/", active: true });
}
