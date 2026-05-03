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

const CACHED_TRIPS_KEY = "wanderlogCachedTrips";
const CACHE_TTL_MS = 10 * 60 * 1000;
const TRIP_API_CANDIDATES = [
  "/api/trips",
  "/api/user/trips",
  "/api/users/me/trips",
  "/api/me/trips",
  "/api/v1/trips",
  "/api/v2/trips"
];

async function getWanderlogTrips() {
  // 1. Use trips cached by the app.wanderlog.com content script — populated
  //    automatically when the user browses any Wanderlog trip page.
  const cached = await chrome.storage.local.get(CACHED_TRIPS_KEY);
  const cachedData = cached[CACHED_TRIPS_KEY];
  if (cachedData?.trips?.length > 0 && Date.now() - cachedData.cachedAt < CACHE_TTL_MS) {
    return cachedData.trips;
  }
  const staleTrips = cachedData?.trips?.length > 0 ? cachedData.trips : null;

  // 2. If a Wanderlog tab is already open, ask its content script directly.
  //    This refreshes the cache via page state / DOM scraping without opening a new tab.
  const tabs = await chrome.tabs.query({ url: "https://app.wanderlog.com/*" });
  const openTab = tabs.find((t) => !t.discarded);
  if (openTab) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const trips = await proxyToWanderlogTab(openTab.id, { type: "WL_GET_TRIPS" }, "trips");
        if (trips?.length > 0) {
          return trips;
        }
      } catch (_e) {}

      await sleep(700);
    }
  }

  // 3. Try direct authenticated API reads from the extension service worker.
  //    This helps Reload do useful work even when no Wanderlog tab is open.
  const directTrips = await fetchTripsFromWanderlogApi();
  if (directTrips?.length > 0) {
    await chrome.storage.local.set({
      [CACHED_TRIPS_KEY]: { trips: directTrips, source: "background-api", cachedAt: Date.now() }
    });
    return directTrips;
  }

  if (staleTrips) {
    return staleTrips;
  }

  // 4. No cached data and no open tab — tell the user what to do.
  throw new Error(
    "Open app.wanderlog.com and browse to one of your trips, then click Reload in the extension."
  );
}

async function fetchTripsFromWanderlogApi() {
  for (const path of TRIP_API_CANDIDATES) {
    try {
      const response = await fetchWithTimeout(`${WANDERLOG_APP_URL}${path}`, {
        credentials: "include"
      }, 1200);
      if (!response.ok) {
        continue;
      }

      const data = await response.json();
      const trips = extractTripsFromResponse(data, path);
      if (trips?.length > 0) {
        return trips;
      }
    } catch (_error) {}
  }

  return null;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function sendClipToWanderlog(payload) {
  const tabId = await ensureWanderlogAppTab({ background: false });
  return proxyToWanderlogTab(tabId, { type: "WL_CREATE_NOTE", payload }, "result");
}

async function sendDestinationsToWanderlog(payload) {
  const tabId = await ensureWanderlogAppTab({ background: false });
  return proxyToWanderlogTab(tabId, { type: "WL_ADD_DESTINATIONS", payload }, "result");
}

function extractTripsFromResponse(data, pathHint = "") {
  if (!data || typeof data !== "object") {
    return null;
  }

  const trips = [];
  const seenObjects = new WeakSet();

  visit(data, pathHint ? [pathHint] : []);
  return trips.length > 0 ? uniqueTrips(trips) : null;

  function visit(value, keyPath) {
    if (!value || typeof value !== "object" || seenObjects.has(value)) {
      return;
    }

    seenObjects.add(value);

    if (Array.isArray(value)) {
      const arrayTrips = value.map(normalizeTrip).filter(Boolean);
      if (
        arrayTrips.length > 0 &&
        (keyPath.join(".").match(/trip/i) || value.some(hasTripSpecificFields))
      ) {
        trips.push(...arrayTrips);
      }

      value.forEach((item, index) => visit(item, [...keyPath, String(index)]));
      return;
    }

    const trip = normalizeTrip(value);
    if (trip && keyPath.join(".").match(/trip/i)) {
      trips.push(trip);
    }

    Object.entries(value).forEach(([key, child]) => {
      visit(child, [...keyPath, key]);
    });
  }
}

function normalizeTrip(value) {
  const id = value?.id || value?.tripId || value?.trip_id || value?.planId || value?.plan_id;
  const name =
    value?.name ||
    value?.title ||
    value?.displayName ||
    value?.tripName ||
    value?.trip_name ||
    value?.planName ||
    value?.plan_name;

  if (!id || !name) {
    return null;
  }

  return {
    id: String(id),
    name: String(name).replace(/\s+/g, " ").trim()
  };
}

function hasTripSpecificFields(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  return Boolean(
    value.tripId ||
      value.trip_id ||
      value.tripName ||
      value.trip_name ||
      value.planId ||
      value.plan_id ||
      value.planName ||
      value.plan_name
  );
}

function uniqueTrips(trips) {
  const seen = new Set();
  return trips.filter((trip) => {
    if (!trip.id || seen.has(trip.id)) {
      return false;
    }

    seen.add(trip.id);
    return true;
  });
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
      files: ["wanderlog-page-bridge.js"],
      world: "MAIN"
    });
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
