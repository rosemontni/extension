const STORAGE_KEY = "wanderlogSearches";
const CLIPS_STORAGE_KEY = "wanderlogClips";
const PENDING_CLIP_KEY = "wanderlogPendingClip";
const RECENT_TRIPS_KEY = "wanderlogRecentTripLabels";
const MAX_CLIP_TEXT_LENGTH = 2000;

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

let currentContext = {
  title: "Untitled page",
  url: "",
  selection: ""
};
let currentClip = null;

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
  chrome.tabs.create({ url: "https://app.wanderlog.com/", active: true });
});

cancelClipButton.addEventListener("click", async () => {
  await chrome.storage.local.remove(PENDING_CLIP_KEY);
  currentClip = null;
  clipCard.classList.add("hidden");
  renderEntries(await getEntries());
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
  renderContext(currentContext);
  searchInput.value = currentContext.selection || currentContext.title || "";
  await loadPendingClip();
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
  const data = await chrome.storage.local.get([STORAGE_KEY, CLIPS_STORAGE_KEY]);
  const searches = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
  const clips = Array.isArray(data[CLIPS_STORAGE_KEY]) ? data[CLIPS_STORAGE_KEY] : [];

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

function formatClipNote(clip) {
  const noteText = clip.selectedText.includes("\n")
    ? `${clip.noteType}:\n${clip.selectedText}`
    : `${clip.noteType}: ${clip.selectedText}`;
  const metadata = [];

  if (clip.tripLabel) {
    metadata.push(`Trip: ${clip.tripLabel}`);
  }

  metadata.push(
    clip.destinationLabel
      ? `${clip.destinationType}: ${clip.destinationLabel}`
      : `Destination: ${clip.destinationType}`
  );

  if (clip.sourceTitle) {
    metadata.push(`Source: ${clip.sourceTitle}`);
  }

  if (clip.includeSourceUrl && clip.sourceUrl) {
    metadata.push(clip.sourceUrl);
  }

  metadata.push(`Captured: ${new Date(clip.capturedAt).toLocaleString()}`);
  return `${noteText}\n\n${metadata.join("\n")}`;
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

function normalizeClipText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
