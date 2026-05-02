(() => {
  if (window.__wanderlogAppScriptInitialized) {
    return;
  }

  window.__wanderlogAppScriptInitialized = true;

  const API_DISCOVERY_KEY = "wanderlogApiDiscovery";
  const CACHED_TRIPS_KEY = "wanderlogCachedTrips";
  const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
  const PAGE_SOURCE = "wanderlog-notes-clipper-page";
  const EXTENSION_SOURCE = "wanderlog-notes-clipper-extension";

  const CANDIDATE_NOTE_PATHS = (tripId) => [
    `/api/trips/${tripId}/notes`,
    `/api/v1/trips/${tripId}/notes`,
    `/api/v2/trips/${tripId}/notes`,
    `/api/notes`
  ];
  const CANDIDATE_DEST_PATHS = (tripId) => [
    `/api/trips/${tripId}/places`,
    `/api/trips/${tripId}/destinations`,
    `/api/v1/trips/${tripId}/places`,
    `/api/v2/trips/${tripId}/places`,
    `/api/destinations`
  ];

  const discovered = new Map();
  const pendingPageTripRequests = new Map();
  let saveDiscoveryTimer = null;
  let pageTripRequestId = 0;

  chrome.storage.local.get(API_DISCOVERY_KEY).then((data) => {
    const saved = data[API_DISCOVERY_KEY];
    if (saved && typeof saved === "object") {
      Object.entries(saved).forEach(([k, v]) => discovered.set(k, v));
    }
  });

  window.addEventListener("message", handlePageBridgeMessage);

  // Keep intercepting requests made by this extension script. The page-world
  // bridge observes Wanderlog's own app fetches and reports them back here.
  const originalFetch = window.fetch.bind(window);

  window.fetch = async function wanderlogInterceptedFetch(input, init) {
    const response = await originalFetch(input, init);

    try {
      const url =
        input instanceof Request
          ? new URL(input.url, window.location.origin)
          : new URL(String(input), window.location.origin);

      if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
        const method = (
          init?.method ||
          (input instanceof Request ? input.method : "GET")
        ).toUpperCase();
        const path = url.pathname;

        let bodyKeys = [];
        if (init?.body && typeof init.body === "string") {
          try {
            bodyKeys = Object.keys(JSON.parse(init.body));
          } catch (_e) {}
        }

        recordApiDiscovery({ method, path, bodyKeys, lastStatus: response.status });

        // Cache actual trip data from successful GET responses.
        if (method === "GET" && response.ok) {
          const cloned = response.clone();
          cloned
            .json()
            .then((data) => {
              const trips = extractTrips(data, path);
              if (trips && trips.length > 0) {
                cacheTrips(trips, { path });
              }
            })
            .catch(() => {});
        }
      }
    } catch (_e) {}

    return response;
  };

  // On load, try to populate the trip cache immediately from window state
  // and from trip links visible in the page DOM.
  populateCacheFromPage();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "WL_GET_TRIPS") {
      getTrips()
        .then((trips) => sendResponse({ ok: true, trips }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (message?.type === "WL_CREATE_NOTE") {
      createNote(message.payload)
        .then((result) => sendResponse({ ok: true, result }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (message?.type === "WL_ADD_DESTINATIONS") {
      addDestinations(message.payload)
        .then((result) => sendResponse({ ok: true, result }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (message?.type === "WL_GET_API_DISCOVERY") {
      sendResponse({ ok: true, apis: Object.fromEntries(discovered) });
      return false;
    }
  });

  function handlePageBridgeMessage(event) {
    if (event.source !== window || event.data?.source !== PAGE_SOURCE) {
      return;
    }

    if (event.data.type === "WL_PAGE_API") {
      recordApiDiscovery(event.data.api);
      return;
    }

    if (event.data.type === "WL_PAGE_TRIPS") {
      cacheTrips(event.data.trips, {
        path: event.data.path,
        source: event.data.source,
        cachedAt: event.data.cachedAt
      });
      return;
    }

    if (event.data.type === "WL_PAGE_TRIPS_RESPONSE") {
      const pending = pendingPageTripRequests.get(event.data.requestId);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timeoutId);
      pendingPageTripRequests.delete(event.data.requestId);
      const trips = cacheTrips(event.data.trips, { source: "page-bridge" });
      pending.resolve(trips);
    }
  }

  function recordApiDiscovery(api) {
    if (!api?.method || !api?.path) {
      return;
    }

    const key = `${api.method}:${api.path}`;
    const prior = discovered.get(key) || {
      method: api.method,
      path: api.path,
      bodyKeys: [],
      count: 0
    };

    prior.count += 1;
    if (Array.isArray(api.bodyKeys) && api.bodyKeys.length > prior.bodyKeys.length) {
      prior.bodyKeys = api.bodyKeys;
    }
    prior.lastStatus = api.lastStatus;
    discovered.set(key, prior);

    clearTimeout(saveDiscoveryTimer);
    saveDiscoveryTimer = setTimeout(() => {
      chrome.storage.local.set({ [API_DISCOVERY_KEY]: Object.fromEntries(discovered) });
    }, 800);
  }

  function requestTripsFromPageBridge() {
    const requestId = `trips-${Date.now()}-${++pageTripRequestId}`;

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        pendingPageTripRequests.delete(requestId);
        resolve([]);
      }, 1200);

      pendingPageTripRequests.set(requestId, { resolve, timeoutId });
      window.postMessage(
        {
          source: EXTENSION_SOURCE,
          type: "WL_READ_PAGE_TRIPS",
          requestId
        },
        "*"
      );
    });
  }

  function cacheTrips(trips, extra = {}) {
    const normalizedTrips = uniqueTrips(
      (Array.isArray(trips) ? trips : []).map(normalizeTrip).filter(Boolean)
    );
    if (!normalizedTrips.length) {
      return [];
    }

    chrome.storage.local.set({
      [CACHED_TRIPS_KEY]: {
        trips: normalizedTrips,
        path: extra.path,
        source: extra.source,
        cachedAt: extra.cachedAt || Date.now()
      }
    });

    return normalizedTrips;
  }

  async function getTrips() {
    // 1. Check the storage cache (populated by the fetch interceptor
    //    or populateCacheFromPage on previous visits).
    const cached = await chrome.storage.local.get(CACHED_TRIPS_KEY);
    const cachedData = cached[CACHED_TRIPS_KEY];
    if (cachedData?.trips?.length > 0 && Date.now() - cachedData.cachedAt < CACHE_TTL_MS) {
      return cachedData.trips;
    }

    // 2. Ask the page-world bridge. It can see Wanderlog's app state and
    // fetches, while this isolated extension script can persist the result.
    const bridgedTrips = await requestTripsFromPageBridge();
    if (bridgedTrips?.length > 0) {
      return bridgedTrips;
    }

    // 3. Read from the live page DOM available to the extension world.
    const pageTrips = extractFromPage();
    if (pageTrips && pageTrips.length > 0) {
      return cacheTrips(pageTrips, { source: "dom" });
    }

    // 4. Re-fetch using an endpoint we already saw succeed, or discovered patterns.
    const discoveredPath = [...discovered.entries()]
      .filter(([k, v]) => k.startsWith("GET:") && /trip/i.test(k) && v.lastStatus === 200)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([, v]) => v.path)[0];

    if (discoveredPath) {
      try {
        const res = await originalFetch(discoveredPath, { credentials: "same-origin" });
        if (res.ok) {
          const data = await res.json();
          const trips = extractTrips(data, discoveredPath);
          if (trips && trips.length > 0) {
            return cacheTrips(trips, { path: discoveredPath });
          }
        }
      } catch (_e) {}
    }

    throw new Error(
      "Could not read your trips from this Wanderlog page. " +
      "Open a trip in Wanderlog, wait for it to load, then click Reload in the extension."
    );
  }

  function populateCacheFromPage() {
    // Run after a brief delay to let React finish rendering.
    setTimeout(async () => {
      const bridgedTrips = await requestTripsFromPageBridge();
      const trips = bridgedTrips.length > 0 ? bridgedTrips : extractFromPage();
      if (trips && trips.length > 0) {
        chrome.storage.local.get(CACHED_TRIPS_KEY).then((cached) => {
          const existing = cached[CACHED_TRIPS_KEY];
          // Only update if the new list is at least as long or the cache is stale.
          if (
            !existing ||
            trips.length >= existing.trips.length ||
            Date.now() - existing.cachedAt > CACHE_TTL_MS
          ) {
            cacheTrips(trips, { source: "page-load" });
          }
        });
      }
    }, 1200);
  }

  function extractFromPage() {
    // Try common React/Redux window state patterns.
    const windowSources = [
      () => window.__REDUX_STATE__,
      () => window.__PRELOADED_STATE__,
      () => window.__INITIAL_STATE__,
      () => window.__NEXT_DATA__?.props?.pageProps,
      () => window.wanderlogState
    ];

    for (const fn of windowSources) {
      try {
        const state = fn();
        if (!state) {
          continue;
        }
        const trips = extractTrips(state);
        if (trips && trips.length > 0) {
          return trips;
        }
      } catch (_e) {}
    }

    // Scrape trip links from the page DOM — Wanderlog's sidebar lists trips
    // as anchor elements whose href contains "/trip/<id>".
    const seen = new Set();
    const trips = [];

    document.querySelectorAll('a[href*="/trip/"]').forEach((link) => {
      const match = link.pathname.match(/^\/trip\/([^/?#]+)/);
      if (!match || seen.has(match[1])) {
        return;
      }
      const name = link.textContent?.trim();
      if (name && name.length > 0 && name.length < 120) {
        seen.add(match[1]);
        trips.push({ id: match[1], name });
      }
    });

    return trips.length > 0 ? trips : null;
  }

  function extractTrips(data, pathHint = "") {
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
          keyPath.join(".").match(/trip/i)
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

  function normalizeTrip(t) {
    const id = t?.id || t?.tripId || t?.trip_id;
    const name = t?.name || t?.title || t?.tripName || t?.trip_name;

    if (!id || !name) {
      return null;
    }

    return {
      id: String(id),
      name: String(name).replace(/\s+/g, " ").trim()
    };
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

  async function createNote(payload) {
    const { tripId, text, noteType, sourceTitle, sourceUrl, includeSourceUrl } = payload;

    if (!tripId) {
      throw new Error("A trip must be selected to send a note.");
    }

    const body = {
      text,
      type: noteType || "note",
      sourceTitle,
      sourceUrl: includeSourceUrl ? sourceUrl : undefined
    };

    const candidates = CANDIDATE_NOTE_PATHS(tripId).map((path) => ({
      path,
      body: path.includes(tripId) ? body : { ...body, tripId }
    }));

    return postToFirstSuccess(candidates, "note");
  }

  async function addDestinations(payload) {
    const { tripId, items } = payload;

    if (!tripId) {
      throw new Error("A trip must be selected to add destinations.");
    }

    const results = [];
    const errors = [];

    for (const item of items) {
      const body = { geoId: item.geoId, name: item.name };
      const candidates = CANDIDATE_DEST_PATHS(tripId).map((path) => ({
        path,
        body: path.includes(tripId) ? body : { ...body, tripId }
      }));

      try {
        const result = await postToFirstSuccess(candidates, "destination");
        results.push({ name: item.name, ok: true, result });
      } catch (err) {
        errors.push({ name: item.name, error: err.message });
      }
    }

    if (results.length === 0) {
      throw new Error(
        "Could not add any destinations to Wanderlog. The internal API may have changed."
      );
    }

    return { added: results, failed: errors };
  }

  async function postToFirstSuccess(candidates, label) {
    const csrfHeaders = getCsrfHeaders();

    for (const { path, body } of candidates) {
      try {
        const res = await originalFetch(path, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", ...csrfHeaders },
          body: JSON.stringify(body)
        });

        if (res.ok) {
          let result = null;
          try {
            result = await res.json();
          } catch (_e) {}
          return result;
        }
      } catch (_e) {}
    }

    throw new Error(
      `Could not create ${label} in Wanderlog. The internal API may have changed.`
    );
  }

  function getCsrfHeaders() {
    const csrfMeta = document.querySelector('meta[name="csrf-token"]');
    if (csrfMeta?.content) {
      return { "X-CSRF-Token": csrfMeta.content };
    }

    const csrfInput = document.querySelector(
      'input[name="_token"], input[name="csrf_token"], input[name="authenticity_token"]'
    );
    if (csrfInput?.value) {
      return { "X-CSRF-Token": csrfInput.value };
    }

    return {};
  }
})();
