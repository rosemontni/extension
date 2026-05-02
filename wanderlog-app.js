(() => {
  if (window.__wanderlogAppScriptInitialized) {
    return;
  }

  window.__wanderlogAppScriptInitialized = true;

  const API_DISCOVERY_KEY = "wanderlogApiDiscovery";
  const CANDIDATE_TRIP_PATHS = ["/api/trips", "/api/v1/trips", "/api/v2/trips", "/api/user/trips"];
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

  // Discovered API patterns keyed by "METHOD:path"
  const discovered = new Map();
  let saveTimer = null;

  chrome.storage.local.get(API_DISCOVERY_KEY).then((data) => {
    const saved = data[API_DISCOVERY_KEY];
    if (saved && typeof saved === "object") {
      Object.entries(saved).forEach(([k, v]) => discovered.set(k, v));
    }
  });

  // Wrap fetch to intercept Wanderlog's own API calls
  const originalFetch = window.fetch.bind(window);

  window.fetch = async function wanderlogInterceptedFetch(input, init) {
    const response = await originalFetch(input, init);

    try {
      const url =
        input instanceof Request
          ? new URL(input.url, window.location.origin)
          : new URL(String(input), window.location.origin);

      if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
        const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
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

        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          chrome.storage.local.set({ [API_DISCOVERY_KEY]: Object.fromEntries(discovered) });
        }, 800);
      }
    } catch (_e) {}

    return response;
  };

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
    // Prefer a discovered GET endpoint that looks like a trips list
    const discoveredTripPath = [...discovered.entries()]
      .filter(([k, v]) => k.startsWith("GET:") && /trips/.test(k) && v.lastStatus === 200)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([, v]) => v.path)[0];

    const candidates = discoveredTripPath
      ? [discoveredTripPath, ...CANDIDATE_TRIP_PATHS.filter((p) => p !== discoveredTripPath)]
      : CANDIDATE_TRIP_PATHS;

    for (const path of candidates) {
      try {
        const res = await originalFetch(path, { credentials: "same-origin" });
        if (!res.ok) {
          continue;
        }

        const data = await res.json();
        const trips = extractTrips(data);
        if (trips && trips.length > 0) {
          return trips;
        }
      } catch (_e) {}
    }

    throw new Error(
      "Could not load your Wanderlog trips. Make sure you are logged in at app.wanderlog.com."
    );
  }

  function extractTrips(data) {
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
        return candidate.map(normalizeTrip).filter(Boolean);
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
