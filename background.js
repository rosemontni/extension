import { MAX_CLIP_TEXT_LENGTH, normalizeClipText, normalizeSearch } from "./lib/wanderlog-utils.js";

const STORAGE_KEY = "wanderlogSearches";
const PENDING_CLIP_KEY = "wanderlogPendingClip";
const PLACE_MENU_ID = "wanderlog-save-place";
const DESTINATION_MENU_ID = "wanderlog-add-destination";
const CLIP_MENU_ID = "wanderlog-save-selected-text";
const WANDERLOG_APP_URL = "https://app.wanderlog.com";
const WANDERLOG_MAP_URL = "https://extensionembed.wanderlog.com/extension/map";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: PLACE_MENU_ID,
      title: "Save place to Wanderlog",
      contexts: ["page", "selection"]
    });

    chrome.contextMenus.create({
      id: DESTINATION_MENU_ID,
      title: "Add to Wanderlog as destination",
      contexts: ["page", "selection"]
    });

    chrome.contextMenus.create({
      id: CLIP_MENU_ID,
      title: "Save selected text to Wanderlog",
      contexts: ["selection"]
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) {
    return;
  }

  const search = getSearchText({
    selection: info.selectionText,
    title: tab.title,
    url: tab.url
  });

  if (info.menuItemId === PLACE_MENU_ID) {
    await openWanderlogForTab(tab.id, search, tab.url || "");
  } else if (info.menuItemId === DESTINATION_MENU_ID) {
    await openWanderlogDestination(search, tab.url || "");
  } else if (info.menuItemId === CLIP_MENU_ID) {
    await captureSelectedTextClip(info, tab);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OPEN_WANDERLOG_FOR_TAB") {
    openWanderlogForTab(message.tabId, message.search, message.sourceUrl)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message?.type === "OPEN_WANDERLOG_DESTINATION") {
    openWanderlogDestination(message.search, message.sourceUrl)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message?.type === "RESOLVE_WANDERLOG_DESTINATION") {
    resolveDestinationGeo(message.search)
      .then((geo) =>
        sendResponse({
          ok: true,
          result: geo
            ? {
                geoId: geo.id,
                matchedName: formatGeoName(geo),
                createUrl: buildWanderlogDestinationUrl(geo)
              }
            : null
        })
      )
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message?.type === "GET_WANDERLOG_TRIPS") {
    getWanderlogTrips()
      .then((trips) => sendResponse({ ok: true, trips }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message?.type === "WANDERLOG_SEND_CLIP") {
    sendClipToWanderlog(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message?.type === "WANDERLOG_SEND_DESTINATIONS") {
    sendDestinationsToWanderlog(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  return undefined;
});

async function captureSelectedTextClip(info, tab) {
  const selectedText = normalizeClipText(info.selectionText);
  if (!selectedText) {
    throw new Error("Highlight text before saving a Wanderlog note.");
  }

  if (selectedText.length > MAX_CLIP_TEXT_LENGTH) {
    throw new Error(`Selected text is too long. Keep clips under ${MAX_CLIP_TEXT_LENGTH} characters.`);
  }

  const sourceUrl = tab.url || info.pageUrl || "";
  const clip = {
    id: crypto.randomUUID(),
    selectedText,
    sourceTitle: tab.title || "Untitled page",
    sourceUrl,
    domain: getDomain(sourceUrl),
    capturedAt: new Date().toISOString(),
    status: "draft"
  };

  await chrome.storage.local.set({ [PENDING_CLIP_KEY]: clip });
  await openClipPopup();
}

async function openClipPopup() {
  if (chrome.action.openPopup) {
    try {
      await chrome.action.openPopup();
      return;
    } catch (_error) {
      // Chrome may reject openPopup in some contexts; use a focused extension tab.
    }
  }

  await chrome.tabs.create({
    url: chrome.runtime.getURL("popup.html?clip=1"),
    active: true
  });
}

async function openWanderlogDestination(search, sourceUrl) {
  const trimmedSearch = normalizeSearch(search);
  if (!trimmedSearch) {
    throw new Error("Choose a destination name or highlight destination text first.");
  }

  const geo = await resolveDestinationGeo(trimmedSearch);
  await rememberSearch({
    search: trimmedSearch,
    kind: "destination",
    matchedName: geo ? formatGeoName(geo) : "",
    sourceUrl: sourceUrl || "",
    openedAt: new Date().toISOString()
  });

  await chrome.tabs.create({
    url: buildWanderlogDestinationUrl(geo),
    active: true
  });

  return {
    mode: "tab",
    kind: "destination",
    matchedName: geo ? formatGeoName(geo) : null
  };
}

async function resolveDestinationGeo(search) {
  const response = await fetch(
    `${WANDERLOG_APP_URL}/api/geo/autocomplete/${encodeURIComponent(search)}`,
    { credentials: "include" }
  );

  if (!response.ok) {
    throw new Error("Could not resolve that destination in Wanderlog.");
  }

  const payload = await response.json();
  const results = Array.isArray(payload?.data) ? payload.data : [];
  return results.find((geo) => geo?.id && geo?.name) || null;
}

function buildWanderlogDestinationUrl(geo) {
  const url = new URL(`${WANDERLOG_APP_URL}/plan/create/plan`);
  if (geo?.id) {
    url.searchParams.set("geoId", String(geo.id));
  }

  return url.toString();
}

function formatGeoName(geo) {
  return [geo.name, geo.stateName, geo.countryName].filter(Boolean).join(", ");
}

async function openWanderlogForTab(tabId, search, sourceUrl) {
  const trimmedSearch = normalizeSearch(search);
  if (!trimmedSearch) {
    throw new Error("Choose a place name or highlight place text first.");
  }

  await rememberSearch({
    search: trimmedSearch,
    kind: "place",
    sourceUrl: sourceUrl || "",
    openedAt: new Date().toISOString()
  });

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "OPEN_WANDERLOG_PANEL",
      search: trimmedSearch
    });
    return { mode: "panel", kind: "place" };
  } catch (_messageError) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"]
      });
      await chrome.tabs.sendMessage(tabId, {
        type: "OPEN_WANDERLOG_PANEL",
        search: trimmedSearch
      });
      return { mode: "panel", kind: "place" };
    } catch (_injectError) {
      await chrome.tabs.create({
        url: buildWanderlogMapUrl(trimmedSearch),
        active: true
      });
      return { mode: "tab", kind: "place" };
    }
  }
}

async function rememberSearch(searchRecord) {
  const current = await chrome.storage.local.get(STORAGE_KEY);
  const searches = Array.isArray(current[STORAGE_KEY]) ? current[STORAGE_KEY] : [];
  await chrome.storage.local.set({
    [STORAGE_KEY]: [searchRecord, ...searches].slice(0, 25)
  });
}

function getSearchText({ selection, title, url }) {
  return normalizeSearch(selection) || normalizeSearch(title) || normalizeSearch(url);
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_error) {
    return "";
  }
}

function buildWanderlogMapUrl(search) {
  const url = new URL(WANDERLOG_MAP_URL);
  url.searchParams.set("search", search);
  return url.toString();
}

// --- Direct Wanderlog write support ---

async function getWanderlogTrips() {
  // Try reading trips directly from background via credentialed fetch first.
  // This works for the geo API and may work for trips too.
  const candidates = [
    `${WANDERLOG_APP_URL}/api/trips`,
    `${WANDERLOG_APP_URL}/api/v1/trips`,
    `${WANDERLOG_APP_URL}/api/v2/trips`,
    `${WANDERLOG_APP_URL}/api/user/trips`
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        const trips = extractTripsFromResponse(data);
        if (trips && trips.length > 0) {
          return trips;
        }
      }
    } catch (_e) {}
  }

  // Fall back to content script proxy in an open Wanderlog tab.
  const tabId = await ensureWanderlogAppTab({ background: true });
  return proxyToWanderlogTab(tabId, { type: "WL_GET_TRIPS" }, "trips");
}

async function sendClipToWanderlog(payload) {
  const tabId = await ensureWanderlogAppTab({ background: false });
  return proxyToWanderlogTab(tabId, { type: "WL_CREATE_NOTE", payload }, "result");
}

async function sendDestinationsToWanderlog(payload) {
  const tabId = await ensureWanderlogAppTab({ background: false });
  return proxyToWanderlogTab(tabId, { type: "WL_ADD_DESTINATIONS", payload }, "result");
}

function extractTripsFromResponse(data) {
  const candidates = [
    data,
    data?.trips,
    data?.data,
    data?.data?.trips,
    data?.result,
    data?.result?.trips
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0 && candidate[0]?.id) {
      return candidate
        .map((t) => ({
          id: String(t.id),
          name: t.name || t.title || t.tripName || `Trip ${t.id}`
        }))
        .filter((t) => t.id);
    }
  }

  return null;
}

async function ensureWanderlogAppTab({ background }) {
  const tabs = await chrome.tabs.query({ url: "https://app.wanderlog.com/*" });
  const activeTab = tabs.find((t) => !t.discarded);

  if (activeTab) {
    return activeTab.id;
  }

  if (background) {
    throw new Error(
      "Open app.wanderlog.com in a tab so the extension can read your trips."
    );
  }

  const newTab = await chrome.tabs.create({ url: WANDERLOG_APP_URL, active: true });
  // Wait for the content script to initialize after page load.
  await new Promise((resolve) => setTimeout(resolve, 3500));
  return newTab.id;
}

async function proxyToWanderlogTab(tabId, message, resultKey) {
  let response;

  try {
    response = await chrome.tabs.sendMessage(tabId, message);
  } catch (_e) {
    // Content script may not be ready yet; inject and retry once.
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["wanderlog-app.js"]
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    response = await chrome.tabs.sendMessage(tabId, message);
  }

  if (!response?.ok) {
    throw new Error(response?.error || `Wanderlog returned an unexpected response.`);
  }

  return response[resultKey];
}
