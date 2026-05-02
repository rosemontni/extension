(() => {
  if (window.__wanderlogAppScriptInitialized) {
    return;
  }

  window.__wanderlogAppScriptInitialized = true;

  const API_DISCOVERY_KEY = "wanderlogApiDiscovery";
  const CACHED_TRIPS_KEY = "wanderlogCachedTrips";
  const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

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
  let saveDiscoveryTimer = null;

  chrome.storage.local.get(API_DISCOVERY_KEY).then((data) => {
    const saved = data[API_DISCOVERY_KEY];
    if (saved && typeof saved === "object") {
      Object.entries(saved).forEach(([k, v]) => discovered.set(k, v));
    }
  });

  // Wrap fetch to intercept Wanderlog's own API calls.
  // This serves two purposes:
  //   1. Record endpoint patterns for write operations.
  //   2. Clone successful GET responses to cache trip data without
  //      the guessing-game of re-fetching unknown endpoints later.
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
        const key = `${method}:${path}`;

        let bodyKeys = [];
        if (init?.body && typeof init.body === "string") {
          try {
            bodyKeys = Object.keys(JSON.parse(init.body));
          } catch (_e) {}
        }

        const prior = discovered.get(key) || { method, path, bodyKeys: [], count: 0 };
        prior.count += 1;
        if (bodyKeys.length > prior.bodyKeys.length) {
          prior.bodyKeys = bodyKeys;
        }
        prior.lastStatus = response.status;
        discovered.set(key, prior);

        clearTimeout(saveDiscoveryTimer);
        saveDiscoveryTimer = setTimeout(() => {
          chrome.storage.local.set({ [API_DISCOVERY_KEY]: Object.fromEntries(discovered) });
        }, 800);

        // Cache actual trip data from successful GET responses.
        if (method === "GET" && response.ok) {
          const cloned = response.clone();
          cloned
            .json()
            .then((data) => {
              const trips = extractTrips(data);
              if (trips && trips.length > 0) {
                chrome.storage.local.set({
                  [CACHED_TRIPS_KEY]: { trips, path, cachedAt: Date.now() }
                });
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

  async function getTrips() {
    // 1. Check the storage cache (populated by the fetch interceptor
    //    or populateCacheFromPage on previous visits).
    const cached = await chrome.storage.local.get(CACHED_TRIPS_KEY);
    const cachedData = cached[CACHED_TRIPS_KEY];
    if (cachedData?.trips?.length > 0 && Date.now() - cachedData.cachedAt < CACHE_TTL_MS) {
      return cachedData.trips;
    }

    // 2. Read from the live page — window state and DOM links.
    const pageTrips = extractFromPage();
    if (pageTrips && pageTrips.length > 0) {
      chrome.storage.local.set({
        [CACHED_TRIPS_KEY]: { trips: pageTrips, cachedAt: Date.now() }
      });
      return pageTrips;
    }

    // 3. Re-fetch using an endpoint we already saw succeed, or discovered patterns.
    const discoveredPath = [...discovered.entries()]
      .filter(([k, v]) => k.startsWith("GET:") && /trip/i.test(k) && v.lastStatus === 200)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([, v]) => v.path)[0];

    if (discoveredPath) {
      try {
        const res = await originalFetch(discoveredPath, { credentials: "same-origin" });
        if (res.ok) {
          const data = await res.json();
          const trips = extractTrips(data);
          if (trips && trips.length > 0) {
            chrome.storage.local.set({
              [CACHED_TRIPS_KEY]: { trips, path: discoveredPath, cachedAt: Date.now() }
            });
            return trips;
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
    setTimeout(() => {
      const trips = extractFromPage();
      if (trips && trips.length > 0) {
        chrome.storage.local.get(CACHED_TRIPS_KEY).then((cached) => {
          const existing = cached[CACHED_TRIPS_KEY];
          // Only update if the new list is at least as long or the cache is stale.
          if (
            !existing ||
            trips.length >= existing.trips.length ||
            Date.now() - existing.cachedAt > CACHE_TTL_MS
          ) {
            chrome.storage.local.set({
              [CACHED_TRIPS_KEY]: { trips, cachedAt: Date.now() }
            });
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

  function extractTrips(data) {
    if (!data || typeof data !== "object") {
      return null;
    }

    const candidates = [
      data,
      data.trips,
      data.data,
      data.data?.trips,
      data.result,
      data.result?.trips,
      data.pageProps?.trips
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate) && candidate.length > 0 && candidate[0]?.id) {
        const trips = candidate.map(normalizeTrip).filter(Boolean);
        if (trips.length > 0) {
          return trips;
        }
      }
    }

    return null;
  }

  function normalizeTrip(t) {
    if (!t?.id) {
      return null;
    }

    return {
      id: String(t.id),
      name: t.name || t.title || t.tripName || `Trip ${t.id}`
    };
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
