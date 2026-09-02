const OVERVIEW_PATH = "/user/overview";
const HOST_ID = "ascension-history-host";
const STYLE_ID = "ascension-history-styles";

const LAUNCHER_CLASSES = [
  "flex", "justify-center", "transition", "select-none",
  "border-2", "py-2", "px-4", "text-foreground", "rounded-full",
  "font-semibold", "bg-secondary-alt", "hover:bg-secondary-alt2",
  "border-none", "items-center", "gap-2", "w-full", "text-sm",
  "font-default", "normal-case", "ascension-history-launcher",
].join(" ");

function isOverviewPage() {
  return location.pathname.includes(OVERVIEW_PATH);
}

function findMountPoint() {
  for (const h2 of document.querySelectorAll("h2")) {
    if (!/your information/i.test(h2.textContent || "")) continue;

    const card = h2.closest("div.bg-secondary");
    if (!card) continue;

    const content = card.querySelector(":scope > div.flex.flex-col.flex-1");
    if (content) return content;
  }

  return null;
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL("lib/panel.css");
  document.head.appendChild(link);
}

function runRefresh(panel, connectOrdersRefresh, { force = false } = {}) {
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

async function ensureData(panel, panelApi, loaded) {
  if (loaded.value) return;

  const cached = await panelApi.loadCachedOrders();
  if (cached) panel.applyPayload(cached);

  runRefresh(panel, panelApi.connectOrdersRefresh);
  loaded.value = true;
}

async function loadPanelApi() {
  return import(chrome.runtime.getURL("lib/panel.js"));
}

function removeHost() {
  document.getElementById(HOST_ID)?.remove();
}

function mount() {
  if (!isOverviewPage()) {
    removeHost();
    return false;
  }

  if (document.getElementById(HOST_ID)) return true;

  const target = findMountPoint();
  if (!target) return false;

  ensureStyles();

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.className = "flex flex-col gap-4 pt-6 border-t border-neutral-600 min-w-0 mt-4 ascension-history-host";

  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = LAUNCHER_CLASSES;
  launcher.textContent = "Transaction History";
  launcher.setAttribute("aria-expanded", "false");

  const panelWrap = document.createElement("div");
  panelWrap.className = "ah-panel-wrap hidden";

  host.append(launcher, panelWrap);
  target.append(host);

  let panel = null;
  let panelApi = null;
  const loaded = { value: false };

  launcher.addEventListener("click", async () => {
    const hidden = panelWrap.classList.toggle("hidden");
    const isOpen = !hidden;
    launcher.setAttribute("aria-expanded", String(isOpen));
    launcher.textContent = isOpen ? "Hide Transaction History" : "Transaction History";

    if (!isOpen) return;

    try {
      if (!panelApi) {
        panelApi = await loadPanelApi();
        panel = panelApi.createPanel(panelWrap, {
          onRefresh: ({ force }) => runRefresh(panel, panelApi.connectOrdersRefresh, { force }),
        });
      }
      await ensureData(panel, panelApi, loaded);
    } catch (err) {
      console.error("[Ascension History]", err);
      panelWrap.classList.remove("hidden");
      panelWrap.innerHTML = `<div class="ah-error">Failed to load extension panel: ${err.message}</div>`;
    }
  });

  return true;
}

function tryMount() {
  mount();
}

function watchNavigation() {
  const notify = () => setTimeout(tryMount, 0);

  window.addEventListener("popstate", notify);

  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function patchedHistory(...args) {
      const result = original.apply(this, args);
      notify();
      return result;
    };
  }
}

function boot() {
  tryMount();

  const observer = new MutationObserver(() => {
    if (isOverviewPage() && !document.getElementById(HOST_ID)) {
      tryMount();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  watchNavigation();
  setInterval(() => {
    if (isOverviewPage() && !document.getElementById(HOST_ID)) tryMount();
  }, 1500);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
