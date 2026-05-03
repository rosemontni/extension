const port = process.argv[2] || "9226";
const extensionIdArg = process.argv[3] || "";

const cdp = await connectCdp(port);
const consoleMessages = [];

try {
  const targets = await cdp.send("Target.getTargets");
  const extensionTarget = targets.targetInfos.find((target) =>
    target.url.startsWith("chrome-extension://") && target.url.endsWith("/background.js")
  );

  if (!extensionTarget && !extensionIdArg) {
    throw new Error("Extension service worker target was not found. Is the unpacked extension loaded?");
  }

  const extensionId = extensionIdArg || new URL(extensionTarget.url).hostname;
  const appPage = await createPage(cdp, "about:blank");

  cdp.on("Fetch.requestPaused", appPage.sessionId, async (event) => {
    await fulfillMockWanderlogRequest(cdp, appPage.sessionId, event);
  });

  cdp.on("Runtime.consoleAPICalled", appPage.sessionId, (event) => {
    consoleMessages.push({
      page: "wanderlog",
      type: event.type,
      text: event.args.map((arg) => arg.value || arg.description || "").join(" ")
    });
  });
  cdp.on("Runtime.exceptionThrown", appPage.sessionId, (event) => {
    consoleMessages.push({
      page: "wanderlog",
      type: "exception",
      text: event.exceptionDetails.text
    });
  });

  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, appPage.sessionId);
  await cdp.send("Page.navigate", { url: "https://app.wanderlog.com/trip/mock-trip" }, appPage.sessionId);
  await wait(1800);

  const popup = await createPage(cdp, `chrome-extension://${extensionId}/popup.html?clip=1`);
  cdp.on("Runtime.consoleAPICalled", popup.sessionId, (event) => {
    consoleMessages.push({
      page: "popup",
      type: event.type,
      text: event.args.map((arg) => arg.value || arg.description || "").join(" ")
    });
  });
  cdp.on("Runtime.exceptionThrown", popup.sessionId, (event) => {
    consoleMessages.push({
      page: "popup",
      type: "exception",
      text: event.exceptionDetails.text
    });
  });

  await wait(1200);

  const result = await evaluate(
    cdp,
    popup.sessionId,
    `async () => {
      const loadButton = document.getElementById("load-trips-button");
      const select = document.getElementById("clip-trip-select");
      const status = document.getElementById("clip-status-text");
      if (!loadButton || !select || !status) {
        return { ok: false, error: "Popup controls were not found." };
      }

      loadButton.click();
      await new Promise((resolve) => setTimeout(resolve, 3500));

      return {
        ok: true,
        status: status.textContent,
        disabled: select.disabled,
        value: select.value,
        options: [...select.options].map((option) => ({
          value: option.value,
          text: option.textContent
        }))
      };
    }`
  );

  const options = result?.options || [];
  const tripOptions = options.filter((option) => option.value);
  const passed = result?.ok && tripOptions.some((option) => option.text === "Mock Tokyo Trip");

  console.log(JSON.stringify(
    {
      passed,
      extensionId,
      popupResult: result,
      consoleMessages
    },
    null,
    2
  ));

  if (!passed) {
    process.exitCode = 1;
  }
} finally {
  cdp.close();
}

async function fulfillMockWanderlogRequest(cdp, sessionId, event) {
  const url = event.request.url;
  const headers = [{ name: "Access-Control-Allow-Origin", value: "*" }];

  if (url === "https://app.wanderlog.com/trip/mock-trip") {
    await cdp.send(
      "Fetch.fulfillRequest",
      {
        requestId: event.requestId,
        responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "text/html; charset=utf-8" }],
        body: Buffer.from(mockTripHtml()).toString("base64")
      },
      sessionId
    );
    return;
  }

  if (url === "https://app.wanderlog.com/api/bootstrap") {
    await cdp.send(
      "Fetch.fulfillRequest",
      {
        requestId: event.requestId,
        responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }, ...headers],
        body: Buffer.from(JSON.stringify({
          data: {
            trips: [
              { id: "trip-api-1", name: "Mock Tokyo Trip" },
              { tripId: "trip-api-2", tripName: "Mock Paris Trip" }
            ]
          }
        })).toString("base64")
      },
      sessionId
    );
    return;
  }

  await cdp.send(
    "Fetch.fulfillRequest",
    {
      requestId: event.requestId,
      responseCode: 204,
      responseHeaders: headers,
      body: ""
    },
    sessionId
  );
}

function mockTripHtml() {
  return `<!doctype html>
    <html>
      <head><title>Mock Wanderlog Trip</title></head>
      <body>
        <nav>
          <a href="/plan/trip-dom-1">Mock Kyoto Trip</a>
        </nav>
        <script>
          window.__NEXT_DATA__ = {
            props: {
              pageProps: {
                viewer: {
                  trips: [{ tripId: "trip-state-1", tripName: "Mock State Trip" }]
                }
              }
            }
          };

          setTimeout(() => {
            fetch("/api/bootstrap").catch(() => {});
          }, 100);
        </script>
      </body>
    </html>`;
}

async function createPage(cdp, url) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  if (url !== "about:blank") {
    await cdp.send("Page.navigate", { url }, sessionId);
  }
  return { targetId, sessionId };
}

async function evaluate(cdp, sessionId, functionSource) {
  const response = await cdp.send(
    "Runtime.evaluate",
    {
      expression: `(${functionSource})()`,
      awaitPromise: true,
      returnByValue: true
    },
    sessionId
  );

  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || "Browser evaluation failed.");
  }

  return response.result.value;
}

async function connectCdp(port) {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  let nextId = 1;
  const callbacks = new Map();
  const eventHandlers = new Map();

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && callbacks.has(message.id)) {
      const { resolve, reject } = callbacks.get(message.id);
      callbacks.delete(message.id);
      if (message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve(message.result);
      }
      return;
    }

    const key = eventKey(message.method, message.sessionId);
    for (const handler of eventHandlers.get(key) || []) {
      Promise.resolve(handler(message.params)).catch(() => {});
    }
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  return {
    send(method, params = {}, sessionId) {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      return new Promise((resolve, reject) => callbacks.set(id, { resolve, reject }));
    },
    on(method, sessionId, handler) {
      const key = eventKey(method, sessionId);
      const handlers = eventHandlers.get(key) || [];
      handlers.push(handler);
      eventHandlers.set(key, handlers);
    },
    close() {
      ws.close();
    }
  };
}

function eventKey(method, sessionId) {
  return `${sessionId || ""}:${method}`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
