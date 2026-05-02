(() => {
  if (window.__wanderlogSaveDemoInitialized) {
    return;
  }

  window.__wanderlogSaveDemoInitialized = true;

  const WANDERLOG_IFRAME_ID = "wanderlogSaveDemoIframe";
  const WANDERLOG_MAP_URL = "https://extensionembed.wanderlog.com/extension/map";
  const WANDERLOG_MESSAGE_HANDLERS = {
    minimizeMapExtensionIframe: minimizeWanderlogPanel,
    expandMapExtensionIframe: expandWanderlogPanel,
    hideMapExtensionIframe: hideWanderlogPanel
  };
  const WANDERLOG_PANEL_HEIGHT = "calc(100% - 32px)";
  let lastSelection = "";

  document.addEventListener("selectionchange", () => {
    const selectedText = window.getSelection()?.toString().trim() || "";
    lastSelection = selectedText.slice(0, 500);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "GET_PAGE_CONTEXT") {
      const liveSelection = window.getSelection()?.toString().trim() || lastSelection;

      sendResponse({
        title: document.title || "Untitled page",
        url: window.location.href,
        selection: liveSelection.slice(0, 500)
      });
      return;
    }

    if (message?.type === "OPEN_WANDERLOG_PANEL") {
      openWanderlogPanel(message.search);
      sendResponse({ ok: true });
    }
  });

  window.addEventListener("message", (event) => {
    let data;

    try {
      data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
    } catch (_error) {
      return;
    }

    const handler = WANDERLOG_MESSAGE_HANDLERS[data?.procedureCallName];
    if (!data?.isWanderlog || typeof data.id !== "number" || !handler) {
      return;
    }

    Promise.resolve()
      .then(() => handler())
      .then((result) => {
        postWanderlogProcedureResponse(event.source, {
          id: data.id,
          status: "done",
          data: result
        });
      })
      .catch((error) => {
        postWanderlogProcedureResponse(event.source, {
          id: data.id,
          status: "error",
          error: {
            name: error.name || "Error",
            message: error.message || "Wanderlog panel action failed.",
            stack: error.stack || ""
          }
        });
      });
  });

  function openWanderlogPanel(search) {
    const normalizedSearch = String(search || "").replace(/\s+/g, " ").trim();
    const iframeUrl = buildWanderlogMapUrl(normalizedSearch);
    let iframe = document.getElementById(WANDERLOG_IFRAME_ID);

    if (!iframe) {
      iframe = document.createElement("iframe");
      iframe.id = WANDERLOG_IFRAME_ID;
      iframe.title = "Wanderlog save panel";
      iframe.style.cssText = [
        "position: fixed",
        "top: 16px",
        "right: 16px",
        "width: 388px",
        `height: ${WANDERLOG_PANEL_HEIGHT}`,
        "z-index: 2147483647",
        "border: 0",
        "border-radius: 16px",
        "box-shadow: 0 16px 48px rgba(0, 0, 0, 0.25)",
        "background: white"
      ].join("; ");
      document.body.appendChild(iframe);
    }

    iframe.src = iframeUrl;
    iframe.style.display = "block";
    iframe.style.height = WANDERLOG_PANEL_HEIGHT;
  }

  function minimizeWanderlogPanel() {
    const iframe = document.getElementById(WANDERLOG_IFRAME_ID);
    if (iframe) {
      iframe.style.height = "80px";
    }
  }

  function expandWanderlogPanel() {
    const iframe = document.getElementById(WANDERLOG_IFRAME_ID);
    if (iframe) {
      iframe.style.height = WANDERLOG_PANEL_HEIGHT;
      iframe.style.display = "block";
    }
  }

  function hideWanderlogPanel() {
    const iframe = document.getElementById(WANDERLOG_IFRAME_ID);
    if (iframe) {
      iframe.style.display = "none";
    }
  }

  function postWanderlogProcedureResponse(target, response) {
    if (!target) {
      return;
    }

    target.postMessage(
      JSON.stringify({
        isWanderlog: true,
        ...response
      }),
      "*"
    );
  }

  function buildWanderlogMapUrl(search) {
    const url = new URL(WANDERLOG_MAP_URL);
    url.searchParams.set("search", search);
    return url.toString();
  }
})();
