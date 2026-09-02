import { connectOrdersRefresh, createPanel, loadCachedOrders } from "../lib/panel.js";

const OVERVIEW_PATH = "/user/overview";
const MOUNT_XPATH = "/html/body/div[3]/main[1]/div/div/div/div[1]/div[2]";

function isOverviewPage() {
  return location.pathname.includes(OVERVIEW_PATH);
}

function findMountPoint() {
  const result = document.evaluate(
    MOUNT_XPATH,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null,
  );
  return result.singleNodeValue;
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

async function ensureData(panel, loaded) {
  if (loaded.value) return;

  const cached = await loadCachedOrders();
  if (cached) panel.applyPayload(cached);

  runRefresh(panel);
  loaded.value = true;
}

function mount() {
  if (!isOverviewPage() || document.getElementById("ascension-history-host")) return false;

  const target = findMountPoint();
  if (!target) return false;

  const host = document.createElement("div");
  host.id = "ascension-history-host";

  const shadow = host.attachShadow({ mode: "open" });
  injectStyles(shadow);

  const root = document.createElement("div");
  root.className = "ah-root";
  shadow.appendChild(root);

  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "ah-launcher";
  launcher.textContent = "Transaction History";
  launcher.setAttribute("aria-expanded", "false");

  const panelWrap = document.createElement("div");
  panelWrap.className = "ah-panel-wrap hidden";

  root.append(launcher, panelWrap);

  const panel = createPanel(panelWrap, {
    onRefresh: ({ force }) => runRefresh(panel, { force }),
  });

  const loaded = { value: false };

  launcher.addEventListener("click", async () => {
    const open = panelWrap.classList.toggle("hidden");
    const isOpen = !open;
    launcher.setAttribute("aria-expanded", String(isOpen));
    launcher.classList.toggle("ah-launcher-open", isOpen);
    launcher.textContent = isOpen ? "Hide Transaction History" : "Transaction History";

    if (isOpen) await ensureData(panel, loaded);
  });

  target.append(host);
  return true;
}

function boot() {
  if (!isOverviewPage()) return;

  if (!mount()) {
    const observer = new MutationObserver(() => {
      if (mount()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
