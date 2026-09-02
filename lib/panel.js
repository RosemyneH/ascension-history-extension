const CACHE_KEY = "ascension_orders_v1";

import {
  analyze,
  formatDate,
  formatUsd,
  orderDescription,
  orderDpAmount,
  orderUsdAmount,
  orderVpAmount,
  shopItems,
  typeLabel,
  usdTracked,
  downloadOrdersCsv,
} from "./ascension.js";

function formatNumber(n) {
  return Number(n || 0).toLocaleString();
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function panelTemplate() {
  return `
    <div class="ah-panel">
      <header class="ah-header">
        <div class="ah-brand">
          <strong>Transaction History</strong>
          <span class="ah-status">Loading…</span>
        </div>
        <div class="ah-header-actions">
          <button type="button" class="ah-export hidden" title="Export CSV">Export CSV</button>
          <button type="button" class="ah-refresh" title="Refresh" aria-label="Refresh">↻</button>
        </div>
      </header>
      <div class="ah-error hidden"></div>
      <div class="ah-progress hidden">
        <div class="ah-progress-bar"><div class="ah-progress-fill"></div></div>
        <span class="ah-progress-text">Fetching…</span>
      </div>
      <div class="ah-summary hidden">
        <div class="ah-stat-grid">
          <article class="ah-stat">
            <span class="ah-stat-label">DP Spent</span>
            <strong class="ah-stat-dp-spent">—</strong>
            <span class="ah-stat-shop-meta"></span>
          </article>
          <article class="ah-stat">
            <span class="ah-stat-label">DP Purchased</span>
            <strong class="ah-stat-dp-bought">—</strong>
            <span class="ah-stat-usd-meta"></span>
          </article>
          <article class="ah-stat">
            <span class="ah-stat-label">Total Orders</span>
            <strong class="ah-stat-total">—</strong>
          </article>
        </div>
        <details class="ah-breakdown">
          <summary>Gateway breakdown</summary>
          <table class="ah-gateway-table">
            <thead>
              <tr><th>Method</th><th>Orders</th><th>DP</th><th>USD</th></tr>
            </thead>
            <tbody></tbody>
          </table>
          <p class="ah-notes"></p>
        </details>
      </div>
      <div class="ah-controls hidden">
        <input class="ah-search" type="search" placeholder="Search items, character, gateway…" autocomplete="off">
        <div class="ah-filters">
          <button type="button" class="ah-filter active" data-filter="all">All</button>
          <button type="button" class="ah-filter" data-filter="0">Shop</button>
          <button type="button" class="ah-filter" data-filter="1">Purchases</button>
        </div>
      </div>
      <div class="ah-list hidden"></div>
      <footer class="ah-footer hidden">
        <span class="ah-list-count"></span>
      </footer>
    </div>
  `;
}

export function createPanel(root, { onRefresh }) {
  root.innerHTML = panelTemplate();

  const els = {
    status: root.querySelector(".ah-status"),
    error: root.querySelector(".ah-error"),
    progress: root.querySelector(".ah-progress"),
    progressFill: root.querySelector(".ah-progress-fill"),
    progressText: root.querySelector(".ah-progress-text"),
    summary: root.querySelector(".ah-summary"),
    controls: root.querySelector(".ah-controls"),
    list: root.querySelector(".ah-list"),
    footer: root.querySelector(".ah-footer"),
    listCount: root.querySelector(".ah-list-count"),
    exportBtn: root.querySelector(".ah-export"),
    refresh: root.querySelector(".ah-refresh"),
    search: root.querySelector(".ah-search"),
    statShopDp: root.querySelector(".ah-stat-dp-spent"),
    statShopOrders: root.querySelector(".ah-stat-shop-meta"),
    statPurchasedDp: root.querySelector(".ah-stat-dp-bought"),
    statPurchasedUsd: root.querySelector(".ah-stat-usd-meta"),
    statTotal: root.querySelector(".ah-stat-total"),
    gatewayTable: root.querySelector(".ah-gateway-table tbody"),
    breakdownNotes: root.querySelector(".ah-notes"),
  };

  let orders = [];
  let stats = null;
  let activeFilter = "all";
  let searchQuery = "";

  function show(el) {
    el.classList.remove("hidden");
  }

  function hide(el) {
    el.classList.add("hidden");
  }

  function setError(message) {
    if (!message) {
      hide(els.error);
      els.error.textContent = "";
      return;
    }
    els.error.textContent = message;
    show(els.error);
  }

  function setStatus(text) {
    els.status.textContent = text;
  }

  function setProgress({ page, lastPage }) {
    const pct = Math.round((page / lastPage) * 100);
    els.progressFill.style.width = `${pct}%`;
    els.progressText.textContent = `Fetching page ${page} of ${lastPage}…`;
  }

  function renderSummary() {
    if (!stats) return;

    els.statShopDp.textContent = formatNumber(stats.shopDp);
    els.statShopOrders.textContent = `${formatNumber(stats.shopOrders)} shop orders · ${formatNumber(stats.shopVp)} VP`;

    els.statPurchasedDp.textContent = formatNumber(stats.purchasedDp);
    let usdText = formatUsd(stats.purchasedUsd);
    if (stats.untrackedOrders) {
      usdText += ` (+~${formatUsd(stats.estimatedMissingUsd).slice(1)} est.)`;
    }
    els.statPurchasedUsd.textContent = usdText;
    els.statTotal.textContent = formatNumber(stats.totalOrders);

    const rows = Object.entries(stats.byGateway).sort((a, b) => b[1].dp - a[1].dp || a[0].localeCompare(b[0]));
    els.gatewayTable.innerHTML = rows.map(([name, row]) => `
      <tr>
        <td>${escapeHtml(name)}</td>
        <td>${row.orders}</td>
        <td>${formatNumber(row.dp)}</td>
        <td>${formatUsd(row.usd)}</td>
      </tr>
    `).join("");

    const notes = [];
    if (stats.untrackedOrders) {
      notes.push(`${stats.untrackedOrders} older orders missing USD in API (~${formatNumber(stats.untrackedDp)} DP estimated).`);
    }
    if (stats.unpurchasedGap > 0) {
      notes.push(`${formatNumber(stats.unpurchasedGap)} DP gap likely from promos/bonuses.`);
    } else if (stats.unpurchasedGap < 0) {
      notes.push(`${formatNumber(-stats.unpurchasedGap)} DP unused balance.`);
    }
    if (stats.cryptoOrders) {
      notes.push(`Crypto: ${stats.cryptoOrders} orders, ${formatNumber(stats.cryptoDp)} DP, ${formatUsd(stats.cryptoUsd)}.`);
    }
    els.breakdownNotes.textContent = notes.join(" ");
  }

  function orderMatchesFilter(order) {
    if (activeFilter !== "all" && String(order.type) !== activeFilter) return false;
    if (!searchQuery) return true;

    const haystack = [
      orderDescription(order),
      (order.data || {}).name,
      formatDate(order.created_at),
      typeLabel(order.type),
      shopItems(order).join(" "),
    ].join(" ").toLowerCase();

    return haystack.includes(searchQuery);
  }

  function renderOrder(order) {
    const type = Number(order.type);
    const dp = orderDpAmount(order);
    const vp = orderVpAmount(order);
    const char = (order.data || {}).name;
    const badgeClass = type === 0 ? "ah-badge-shop" : "ah-badge-purchase";

    let amountHtml = "";
    if (type === 0) {
      if (dp) amountHtml += `<span class="ah-dp ah-dp-spent">-${formatNumber(dp)} DP</span>`;
      if (vp) amountHtml += `<span class="ah-vp">${formatNumber(vp)} VP</span>`;
      if (!dp && !vp) amountHtml = `<span class="ah-vp">Free</span>`;
    } else if (type === 1) {
      amountHtml = `<span class="ah-dp">+${formatNumber(dp)} DP</span>`;
      const usd = orderUsdAmount(order);
      const estimated = usdTracked(order) == null && usd != null;
      if (usd != null) amountHtml += `<span class="ah-usd">${formatUsd(usd, estimated)}</span>`;
    }

    return `
      <article class="ah-order">
        <div class="ah-order-date">${formatDate(order.created_at)}</div>
        <div class="ah-order-main">
          <div class="ah-order-title">${escapeHtml(orderDescription(order))}</div>
          <div class="ah-order-meta">
            <span class="ah-badge ${badgeClass}">${typeLabel(type)}</span>
            ${char ? ` · ${escapeHtml(char)}` : ""}
          </div>
        </div>
        <div class="ah-order-amounts">${amountHtml}</div>
      </article>
    `;
  }

  function getFilteredOrders() {
    return orders.filter(orderMatchesFilter);
  }

  function renderList() {
    const filtered = getFilteredOrders();
    if (!filtered.length) {
      els.list.innerHTML = `<div class="ah-empty">No transactions match your filter.</div>`;
    } else {
      els.list.innerHTML = filtered.map(renderOrder).join("");
    }
    els.listCount.textContent = `${filtered.length.toLocaleString()} shown · ${orders.length.toLocaleString()} total`;
  }

  function renderAll() {
    renderSummary();
    renderList();
    show(els.summary);
    show(els.controls);
    show(els.list);
    show(els.footer);
  }

  function applyPayload(payload) {
    orders = payload.orders;
    stats = analyze(orders);
    if (payload.cachedAt) {
      setStatus(`Cached · ${formatDate(payload.cachedAt)}`);
    } else {
      setStatus(`Updated · ${formatNumber(payload.total)} orders`);
    }
    renderAll();
    show(els.exportBtn);
  }

  root.querySelectorAll(".ah-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelector(".ah-filter.active")?.classList.remove("active");
      btn.classList.add("active");
      activeFilter = btn.dataset.filter;
      renderList();
    });
  });

  els.search.addEventListener("input", () => {
    searchQuery = els.search.value.trim().toLowerCase();
    renderList();
  });

  els.refresh.addEventListener("click", () => onRefresh({ force: true }));

  els.exportBtn.addEventListener("click", () => {
    const filtered = getFilteredOrders();
    if (!filtered.length) return;
    downloadOrdersCsv(filtered);
  });

  return {
    setError,
    setStatus,
    setProgress,
    applyPayload,
    showProgress() {
      show(els.progress);
    },
    hideProgress() {
      hide(els.progress);
    },
    setRefreshing(active) {
      els.refresh.disabled = active;
    },
  };
}

export async function loadCachedOrders() {
  const cached = await chrome.storage.local.get(CACHE_KEY);
  const payload = cached[CACHE_KEY];
  if (!payload?.orders?.length) return null;
  return {
    orders: payload.orders,
    cachedAt: payload.fetchedAt,
    total: payload.orders.length,
  };
}

export async function saveCachedOrders(orders) {
  await chrome.storage.local.set({
    [CACHE_KEY]: {
      orders,
      fetchedAt: new Date().toISOString(),
    },
  });
}

export function connectOrdersRefresh({ onProgress, onDone, onError }) {
  const port = chrome.runtime.connect({ name: "orders" });

  port.onMessage.addListener((message) => {
    if (message.type === "progress") onProgress?.(message);
    if (message.type === "done") onDone?.(message.payload);
    if (message.type === "error") onError?.(message);
  });

  port.onDisconnect.addListener(() => {
    if (chrome.runtime.lastError) {
      onError?.({ error: chrome.runtime.lastError.message });
    }
  });

  return {
    refresh(force = false) {
      port.postMessage({ type: "refresh", force });
    },
    disconnect() {
      port.disconnect();
    },
  };
}
