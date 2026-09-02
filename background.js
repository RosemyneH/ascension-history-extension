import { fetchAllOrders, getCookieString } from "./lib/ascension.js";
import { loadCachedOrders, saveCachedOrders } from "./lib/panel.js";

const PAGE_PATH = "overview.html";

function pageUrl() {
  return chrome.runtime.getURL(PAGE_PATH);
}

async function refreshOrders(force, onProgress) {
  if (!force) {
    const cached = await loadCachedOrders();
    if (cached) return { ...cached, fromCache: true };
  }

  const cookie = await getCookieString();
  if (!cookie.includes("ascension_token=")) {
    const err = new Error("Not logged in");
    err.code = "AUTH";
    throw err;
  }

  const result = await fetchAllOrders(cookie, onProgress);
  await saveCachedOrders(result.orders);
  return {
    orders: result.orders,
    total: result.total,
    fromCache: false,
  };
}

chrome.action.onClicked.addListener(async () => {
  const url = pageUrl();
  const tabs = await chrome.tabs.query({ url: `${url}*` });
  const existing = tabs[0];

  if (existing?.id != null) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return;
  }

  await chrome.tabs.create({ url });
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "orders") return;

  port.onMessage.addListener(async (message) => {
    if (message?.type !== "refresh") return;

    try {
      const payload = await refreshOrders(message.force, (progress) => {
        port.postMessage({ type: "progress", ...progress });
      });
      port.postMessage({ type: "done", payload });
    } catch (err) {
      port.postMessage({
        type: "error",
        error: err.message,
        code: err.code || null,
        status: err.status || null,
      });
    }
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "getCached") {
    loadCachedOrders().then((cached) => sendResponse(cached || null));
    return true;
  }
  return false;
});
