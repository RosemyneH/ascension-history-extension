import { connectOrdersRefresh, createPanel, loadCachedOrders } from "../lib/panel.js";

const OVERVIEW_PATH = "/user/overview";

function isOverviewPage() {
  return location.pathname.includes(OVERVIEW_PATH);
}

function findMountPoint() {
  return (
    document.querySelector("main .container")
    || document.querySelector("main")
    || document.querySelector('[class*="overview"]')
    || document.querySelector("#__next main")
    || document.querySelector("#__next > div")
    || document.body
  );
}

function injectStyles(shadow) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL("lib/panel.css");
  shadow.appendChild(link);
}

function runRefresh(panel, { force = false } = {}) {
  panel.setError("");
  panel.setRefreshing(true);

  const client = connectOrdersRefresh({
    onProgress: (progress) => panel.setProgress(progress),
    onDone: (payload) => {
      panel.applyPayload(payload);
      panel.hideProgress();
      panel.setRefreshing(false);
    },
    onError: (message) => {
      if (message.code === "AUTH") {
        panel.setStatus("Extension ready");
        panel.setError("Could not read your session. Refresh this page while logged in.");
      } else if (message.status === 401 || message.status === 403) {
        panel.setError("Auth failed — refresh the page and try again.");
        panel.setStatus("Error");
      } else {
        panel.setError(`Failed to load: ${message.error}`);
        panel.setStatus("Error");
      }
      panel.hideProgress();
      panel.setRefreshing(false);
    },
  });

  panel.showProgress();
  panel.setStatus(force ? "Fetching order history…" : "Loading…");
  client.refresh(force);
}

async function mount() {
  if (!isOverviewPage() || document.getElementById("ascension-history-host")) return;

  const host = document.createElement("div");
  host.id = "ascension-history-host";

  const shadow = host.attachShadow({ mode: "open" });
  injectStyles(shadow);

  const mountRoot = document.createElement("div");
  shadow.appendChild(mountRoot);

  const panel = createPanel(mountRoot, {
    onRefresh: ({ force }) => runRefresh(panel, { force }),
  });

  findMountPoint().prepend(host);

  const cached = await loadCachedOrders();
  if (cached) panel.applyPayload(cached);

  runRefresh(panel);
}

function boot() {
  if (!isOverviewPage()) return;

  mount();

  const observer = new MutationObserver(() => {
    if (!document.getElementById("ascension-history-host")) mount();
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
