import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const bridgeSource = readFileSync("wanderlog-page-bridge.js", "utf8");

const postedMessages = [];
const listeners = new Map();

class MockRequest {}

class MockResponse {
  constructor(data, status = 200) {
    this.data = data;
    this.status = status;
    this.ok = status >= 200 && status < 300;
  }

  clone() {
    return new MockResponse(this.data, this.status);
  }

  async json() {
    return this.data;
  }
}

const links = [
  {
    href: "https://app.wanderlog.com/trip/trip-dom-1",
    textContent: "  Japan 2026  "
  }
];

const window = {
  location: { origin: "https://app.wanderlog.com" },
  __NEXT_DATA__: {
    props: {
      pageProps: {
        dehydratedState: {
          queries: [
            {
              state: {
                data: {
                  viewer: {
                    trips: [{ tripId: "trip-state-1", tripName: "Italy 2027" }]
                  }
                }
              }
            }
          ]
        }
      }
    }
  },
  addEventListener(type, handler) {
    const handlers = listeners.get(type) || [];
    handlers.push(handler);
    listeners.set(type, handlers);
  },
  postMessage(message) {
    postedMessages.push(message);
  },
  async fetch() {
    return new MockResponse({
      data: {
        viewer: {
          trips: [
            { id: "trip-fetch-1", name: "Japan 2026" },
            { id: "trip-fetch-2", title: "France 2026" }
          ]
        }
      }
    });
  }
};

window.window = window;

const context = vm.createContext({
  URL,
  Request: MockRequest,
  document: {
    querySelectorAll(selector) {
      assert.equal(selector, 'a[href*="/trip/"], a[href*="tripId="]');
      return links;
    }
  },
  window
});

vm.runInContext(bridgeSource, context, { filename: "wanderlog-page-bridge.js" });

await window.fetch("/api/trips/bootstrap", { method: "GET" });
await new Promise((resolve) => setTimeout(resolve, 0));

assert.deepEqual(
  plain(postedMessages.find((message) => message.type === "WL_PAGE_TRIPS")?.trips),
  [
    { id: "trip-fetch-1", name: "Japan 2026" },
    { id: "trip-fetch-2", name: "France 2026" }
  ]
);

postedMessages.length = 0;
window.__wanderlogNotesClipperTrips = null;

const [messageHandler] = listeners.get("message");
messageHandler({
  source: window,
  data: {
    source: "wanderlog-notes-clipper-extension",
    type: "WL_READ_PAGE_TRIPS",
    requestId: "test-request"
  }
});

assert.deepEqual(
  plain(postedMessages.find((message) => message.type === "WL_PAGE_TRIPS_RESPONSE")),
  {
    source: "wanderlog-notes-clipper-page",
    type: "WL_PAGE_TRIPS_RESPONSE",
    requestId: "test-request",
    trips: [{ id: "trip-state-1", name: "Italy 2027" }]
  }
);

console.log("Wanderlog page bridge tests passed.");

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}
