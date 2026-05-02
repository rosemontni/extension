(() => {
  if (window.__wanderlogNotesClipperPageBridge) {
    return;
  }

  window.__wanderlogNotesClipperPageBridge = true;

  const PAGE_SOURCE = "wanderlog-notes-clipper-page";
  const EXTENSION_SOURCE = "wanderlog-notes-clipper-extension";
  const TRIP_CACHE_KEY = "__wanderlogNotesClipperTrips";

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== EXTENSION_SOURCE) {
      return;
    }

    if (event.data.type === "WL_READ_PAGE_TRIPS") {
      postToExtension({
        type: "WL_PAGE_TRIPS_RESPONSE",
        requestId: event.data.requestId,
        trips: readTripsFromPage()
      });
    }
  });

  const originalFetch = window.fetch?.bind(window);
  if (originalFetch) {
    window.fetch = async function wanderlogNotesClipperFetch(input, init) {
      const response = await originalFetch(input, init);
      inspectWanderlogFetch(input, init, response);
      return response;
    };
  }

  function inspectWanderlogFetch(input, init, response) {
    try {
      const url =
        input instanceof Request
          ? new URL(input.url, window.location.origin)
          : new URL(String(input), window.location.origin);

      if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
        return;
      }

      const method = (
        init?.method ||
        (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const path = url.pathname;
      const bodyKeys = getBodyKeys(init);

      postToExtension({
        type: "WL_PAGE_API",
        api: { method, path, bodyKeys, lastStatus: response.status }
      });

      if (method === "GET" && response.ok) {
        response
          .clone()
          .json()
          .then((data) => {
            const trips = extractTrips(data, path);
            if (trips?.length) {
              cacheAndPostTrips(trips, { path });
            }
          })
          .catch(() => {});
      }
    } catch (_error) {}
  }

  function getBodyKeys(init) {
    if (!init?.body || typeof init.body !== "string") {
      return [];
    }

    try {
      return Object.keys(JSON.parse(init.body));
    } catch (_error) {
      return [];
    }
  }

  function readTripsFromPage() {
    const cached = window[TRIP_CACHE_KEY];
    if (cached?.trips?.length) {
      return cached.trips;
    }

    const stateTrips = extractTripsFromWindowState();
    if (stateTrips?.length) {
      cacheAndPostTrips(stateTrips, { source: "window-state" });
      return stateTrips;
    }

    const domTrips = extractTripsFromDom();
    if (domTrips?.length) {
      cacheAndPostTrips(domTrips, { source: "dom" });
      return domTrips;
    }

    return [];
  }

  function extractTripsFromWindowState() {
    const sources = [
      window.__REDUX_STATE__,
      window.__PRELOADED_STATE__,
      window.__INITIAL_STATE__,
      window.__NEXT_DATA__?.props?.pageProps,
      window.wanderlogState
    ];

    for (const source of sources) {
      const trips = extractTrips(source);
      if (trips?.length) {
        return trips;
      }
    }

    return null;
  }

  function extractTripsFromDom() {
    const seen = new Set();
    const trips = [];

    document.querySelectorAll('a[href*="/trip/"], a[href*="tripId="]').forEach((link) => {
      const tripId = getTripIdFromLink(link);
      const name = link.textContent?.replace(/\s+/g, " ").trim();
      if (!tripId || !name || name.length > 120 || seen.has(tripId)) {
        return;
      }

      seen.add(tripId);
      trips.push({ id: tripId, name });
    });

    return trips;
  }

  function getTripIdFromLink(link) {
    try {
      const url = new URL(link.href, window.location.origin);
      const pathMatch = url.pathname.match(/\/trip\/([^/?#]+)/);
      return pathMatch?.[1] || url.searchParams.get("tripId") || "";
    } catch (_error) {
      return "";
    }
  }

  function cacheAndPostTrips(trips, extra = {}) {
    const uniqueTrips = uniqueById(trips);
    if (!uniqueTrips.length) {
      return;
    }

    window[TRIP_CACHE_KEY] = {
      trips: uniqueTrips,
      cachedAt: Date.now(),
      ...extra
    };

    postToExtension({
      type: "WL_PAGE_TRIPS",
      trips: uniqueTrips,
      cachedAt: window[TRIP_CACHE_KEY].cachedAt,
      ...extra
    });
  }

  function extractTrips(data, pathHint = "") {
    const trips = [];
    const seenObjects = new WeakSet();

    visit(data, (value, keyPath) => {
      if (Array.isArray(value)) {
        const arrayTrips = value.map(normalizeTrip).filter(Boolean);
        if (arrayTrips.length && looksLikeTripCollection(value, arrayTrips, keyPath)) {
          trips.push(...arrayTrips);
        }
        return;
      }

      const trip = normalizeTrip(value);
      if (trip && /trip/i.test(keyPath.join("."))) {
        trips.push(trip);
      }
    });

    return uniqueById(trips);

    function visit(value, visitor, keyPath = pathHint ? [pathHint] : []) {
      if (!value || typeof value !== "object" || seenObjects.has(value)) {
        return;
      }

      seenObjects.add(value);
      visitor(value, keyPath);

      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, visitor, [...keyPath, String(index)]));
        return;
      }

      Object.entries(value).forEach(([key, child]) => {
        visit(child, visitor, [...keyPath, key]);
      });
    }
  }

  function looksLikeTripCollection(_originalItems, normalizedTrips, keyPath) {
    const keyHint = /trip/i.test(keyPath.join("."));
    return keyHint && normalizedTrips.length > 0;
  }

  function normalizeTrip(value) {
    if (!value || typeof value !== "object") {
      return null;
    }

    const id = value.id || value.tripId || value.trip_id;
    const name = value.name || value.title || value.tripName || value.trip_name;
    if (!id || !name) {
      return null;
    }

    return {
      id: String(id),
      name: String(name).replace(/\s+/g, " ").trim()
    };
  }

  function uniqueById(trips) {
    const seen = new Set();
    return trips.filter((trip) => {
      if (!trip.id || seen.has(trip.id)) {
        return false;
      }

      seen.add(trip.id);
      return true;
    });
  }

  function postToExtension(message) {
    window.postMessage({ source: PAGE_SOURCE, ...message }, "*");
  }
})();
