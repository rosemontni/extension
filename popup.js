const STORAGE_KEY = "wanderlogSearches";
const entryList = document.getElementById("entry-list");
const entryCount = document.getElementById("entry-count");
const searchInput = document.getElementById("search-input");
const pageTitle = document.getElementById("page-title");
const pageUrl = document.getElementById("page-url");
const selectionBox = document.getElementById("selection-box");
const saveButton = document.getElementById("save-button");
const destinationButton = document.getElementById("destination-button");
const statusText = document.getElementById("status-text");

let currentContext = {
  title: "Untitled page",
  url: "",
  selection: ""
};

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

async function getEntries() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
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

function renderEntries(entries) {
  entryCount.textContent = String(entries.length);

  if (!entries.length) {
    entryList.innerHTML = "<li class=\"entry-item\"><p>No Wanderlog searches yet.</p></li>";
    return;
  }

  entryList.innerHTML = entries
    .slice(0, 5)
    .map((entry) => {
      return `
        <li class="entry-item">
          <h3>${escapeHtml(truncate(entry.search, 70))}</h3>
          <p>${escapeHtml(entry.kind === "destination" ? "Destination" : "Place")}</p>
          ${entry.matchedName ? `<p>${escapeHtml(truncate(entry.matchedName, 90))}</p>` : ""}
          <p>${escapeHtml(new Date(entry.openedAt).toLocaleString())}</p>
        </li>
      `;
    })
    .join("");
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

function truncate(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
