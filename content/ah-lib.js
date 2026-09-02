(() => {
  const CACHE_KEY = "ascension_orders_v1";

  const GATEWAYS = {
    0: "Credit card", 1: "PayPal", 2: "Paymentwall", 3: "Prepaid card",
    4: "Coinbase", 5: "Crypto", 6: "TBank", 7: "Cryptomus",
  };
  const CRYPTO_GATEWAYS = new Set([4, 5, 7]);
  const DP_TIER_USD = {
    3: 1, 9: 1, 18: 5, 36: 10, 58: 15, 63: 15, 96: 25, 105: 25,
    135: 35, 147: 35, 192: 50, 390: 100, 510: 100, 786: 200, 1974: 500,
    30: 10, 33: 10, 55: 15, 77: 25, 110: 35, 225: 50, 455: 100,
    2: 1, 5: 1, 10: 3, 20: 7, 42: 15, 60: 20,
  };
  const ORDER_TYPES = { 0: "Shop", 1: "DP Purchase" };

  function gatewayId(order) {
    const data = order.data || {};
    if (order.paypal) return 1;
    if (data.gateway != null) return Number(data.gateway);
    if (order.ref_type != null) return Number(order.ref_type);
    return null;
  }

  function gatewayName(order) {
    const gid = gatewayId(order);
    if (gid == null) return "Unknown";
    return GATEWAYS[gid] || `Unknown (id ${gid})`;
  }

  function dpAdded(order) {
    const data = order.data || {};
    if (data.add_dp != null) return Number(data.add_dp || 0);
    return Number((data.change_dp || {}).diff || 0);
  }

  function usdTracked(order) {
    if (order.paypal) {
      const value = Number(order.paypal.value || 0);
      return value > 0 ? value : null;
    }
    const raw = ((order.data || {}).additional || {}).payment_amount;
    if (raw == null || raw === "") return null;
    const value = Number(raw);
    return value > 0 ? value : null;
  }

  function shopItems(order) {
    return ((order.data || {}).items || []).map((row) => {
      const name = row.item?.name || `Item #${row.item_id}`;
      const qty = row.quantity || 1;
      return qty > 1 ? `${name} ×${qty}` : name;
    });
  }

  function orderDescription(order) {
    const type = Number(order.type);
    if (type === 0) {
      const items = shopItems(order);
      const char = (order.data || {}).name;
      if (items.length) return items.join(", ");
      return char ? `Shop order (${char})` : "Shop order";
    }
    if (type === 1) return `+${dpAdded(order).toLocaleString()} DP via ${gatewayName(order)}`;
    return `Order type ${type}`;
  }

  function orderDpAmount(order) {
    const type = Number(order.type);
    if (type === 0) return Number((order.data?.price || {}).dp || 0);
    if (type === 1) return dpAdded(order);
    return 0;
  }

  function orderVpAmount(order) {
    if (Number(order.type) !== 0) return 0;
    return Number((order.data?.price || {}).vp || 0);
  }

  function orderUsdAmount(order) {
    if (Number(order.type) !== 1) return null;
    const tracked = usdTracked(order);
    if (tracked != null) return tracked;
    return DP_TIER_USD[dpAdded(order)] ?? null;
  }

  function analyze(orders) {
    let shopDp = 0, shopVp = 0, shopOrders = 0;
    const typeCounts = {}, byGateway = {};
    let trackedUsd = 0, estimatedUsd = 0, untrackedOrders = 0, untrackedDp = 0;

    for (const order of orders) {
      const orderType = Number(order.type ?? -1);
      typeCounts[orderType] = (typeCounts[orderType] || 0) + 1;
      const data = order.data || {};

      if (orderType === 0) {
        const dp = Number((data.price || {}).dp || 0);
        const vp = Number((data.price || {}).vp || 0);
        shopDp += dp;
        shopVp += vp;
        if (dp || vp) shopOrders += 1;
        continue;
      }
      if (orderType !== 1) continue;

      const added = dpAdded(order);
      const name = gatewayName(order);
      if (!byGateway[name]) byGateway[name] = { orders: 0, dp: 0, usd: 0 };
      byGateway[name].orders += 1;
      byGateway[name].dp += added;

      const tracked = usdTracked(order);
      if (tracked != null) {
        trackedUsd += tracked;
        byGateway[name].usd += tracked;
      } else {
        untrackedOrders += 1;
        untrackedDp += added;
        if (DP_TIER_USD[added]) estimatedUsd += DP_TIER_USD[added];
      }
    }

    let cryptoDp = 0, cryptoUsd = 0, cryptoOrders = 0;
    for (const gid of CRYPTO_GATEWAYS) {
      const label = GATEWAYS[gid];
      if (!byGateway[label]) continue;
      cryptoDp += byGateway[label].dp;
      cryptoUsd += byGateway[label].usd;
      cryptoOrders += byGateway[label].orders;
    }

    const purchasedDp = Object.values(byGateway).reduce((sum, row) => sum + row.dp, 0);
    return {
      totalOrders: orders.length, typeCounts, shopDp, shopVp, shopOrders, byGateway,
      purchasedDp, purchasedUsd: trackedUsd, estimatedMissingUsd: estimatedUsd,
      estimatedTrueSpend: trackedUsd + estimatedUsd, untrackedOrders, untrackedDp,
      cryptoDp, cryptoUsd, cryptoOrders, unpurchasedGap: shopDp - purchasedDp,
    };
  }

  function formatUsd(value, estimated = false) {
    if (value == null) return "—";
    return `${estimated ? "~" : ""}$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function formatDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function typeLabel(type) {
    return ORDER_TYPES[type] || `Type ${type}`;
  }

  function typeLabel(type) {
    return ORDER_TYPES[type] || `Type ${type}`;
  }

  function csvCell(value) {
    const text = String(value ?? "");
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function downloadBlob(content, mime, filename) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportFilename(ext) {
    return `ascension-transactions-${new Date().toISOString().slice(0, 10)}.${ext}`;
  }

  function ordersToCsv(orders) {
    const headers = ["Date", "Type", "Description", "Character", "DP", "VP", "USD", "Gateway"];
    const rows = orders.map((order) => {
      const type = Number(order.type);
      const dp = orderDpAmount(order);
      const vp = orderVpAmount(order);
      const usd = orderUsdAmount(order);
      return [
        order.created_at || "",
        typeLabel(type),
        orderDescription(order),
        (order.data || {}).name || "",
        type === 0 ? (dp ? -dp : 0) : dp,
        vp || "",
        usd ?? "",
        type === 1 ? gatewayName(order) : "",
      ];
    });
    return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  }

  function downloadOrdersCsv(orders) {
    downloadBlob(ordersToCsv(orders), "text/csv;charset=utf-8", exportFilename("csv"));
  }

  function ordersToHtml(orders) {
    const stats = analyze(orders);
    const rows = orders.map((order) => {
      const type = Number(order.type);
      const dp = orderDpAmount(order);
      const vp = orderVpAmount(order);
      const usd = orderUsdAmount(order);
      const dpCell = type === 0 ? (dp ? `-${dp}` : "0") : `+${dp}`;
      const usdCell = usd == null ? "—" : formatUsd(usd, usdTracked(order) == null);
      return `<tr>
        <td>${escapeHtml(formatDate(order.created_at))}</td>
        <td>${escapeHtml(typeLabel(type))}</td>
        <td>${escapeHtml(orderDescription(order))}</td>
        <td>${escapeHtml((order.data || {}).name || "")}</td>
        <td class="num">${escapeHtml(dpCell)}</td>
        <td class="num">${vp ? escapeHtml(String(vp)) : "—"}</td>
        <td class="num">${escapeHtml(usdCell)}</td>
        <td>${escapeHtml(type === 1 ? gatewayName(order) : "")}</td>
      </tr>`;
    }).join("");

    const gatewayRows = Object.entries(stats.byGateway)
      .sort((a, b) => b[1].dp - a[1].dp || a[0].localeCompare(b[0]))
      .map(([name, row]) => `<tr>
        <td>${escapeHtml(name)}</td>
        <td class="num">${row.orders}</td>
        <td class="num">${row.dp.toLocaleString()}</td>
        <td class="num">${escapeHtml(formatUsd(row.usd))}</td>
      </tr>`)
      .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ascension Transaction History</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font: 14px/1.5 system-ui, sans-serif; background: #12101a; color: #ece6f8; }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 24px; }
    h1 { margin: 0 0 6px; font-size: 24px; color: #d4af37; }
    .meta { color: #9b92b0; margin-bottom: 20px; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
    .stat { background: #1c1828; border: 1px solid #3a3350; border-radius: 10px; padding: 14px; }
    .stat label { display: block; color: #9b92b0; font-size: 11px; text-transform: uppercase; }
    .stat strong { display: block; margin-top: 4px; font-size: 22px; color: #d4af37; }
    .stat span { color: #9b92b0; font-size: 12px; }
    h2 { font-size: 16px; margin: 24px 0 10px; }
    table { width: 100%; border-collapse: collapse; background: #1c1828; border: 1px solid #3a3350; border-radius: 10px; overflow: hidden; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #3a3350; vertical-align: top; }
    th { background: #211c2e; color: #9b92b0; font-size: 12px; text-transform: uppercase; }
    tr:last-child td { border-bottom: none; }
    .num { text-align: right; white-space: nowrap; }
    @media (max-width: 800px) { .stats { grid-template-columns: 1fr; } table { display: block; overflow-x: auto; } }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Ascension Transaction History</h1>
    <p class="meta">Exported ${escapeHtml(new Date().toLocaleString())} · ${orders.length.toLocaleString()} transactions</p>
    <div class="stats">
      <div class="stat"><label>DP Spent</label><strong>${stats.shopDp.toLocaleString()}</strong><span>${stats.shopOrders.toLocaleString()} shop orders · ${stats.shopVp.toLocaleString()} VP</span></div>
      <div class="stat"><label>DP Purchased</label><strong>${stats.purchasedDp.toLocaleString()}</strong><span>${escapeHtml(formatUsd(stats.purchasedUsd))} tracked</span></div>
      <div class="stat"><label>Total Orders</label><strong>${stats.totalOrders.toLocaleString()}</strong></div>
    </div>
    <h2>Gateway Breakdown</h2>
    <table><thead><tr><th>Method</th><th>Orders</th><th>DP</th><th>USD</th></tr></thead><tbody>${gatewayRows || "<tr><td colspan=\"4\">No purchases</td></tr>"}</tbody></table>
    <h2>Transactions</h2>
    <table><thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Character</th><th>DP</th><th>VP</th><th>USD</th><th>Gateway</th></tr></thead><tbody>${rows}</tbody></table>
  </div>
</body>
</html>`;
  }

  function downloadOrdersHtml(orders) {
    downloadBlob(ordersToHtml(orders), "text/html;charset=utf-8", exportFilename("html"));
  }

  function formatNumber(n) {
    return Number(n || 0).toLocaleString();
  }

  function panelTemplate() {
    return `<div class="ah-panel">
      <header class="ah-header">
        <div class="ah-brand"><strong>Transaction History</strong><span class="ah-status">Loading…</span></div>
        <div class="ah-header-actions">
          <div class="ah-export-group hidden">
            <button type="button" class="ah-export ah-export-csv">CSV</button>
            <button type="button" class="ah-export ah-export-html">HTML</button>
          </div>
          <button type="button" class="ah-refresh" title="Refresh" aria-label="Refresh">↻</button>
        </div>
      </header>
      <div class="ah-error hidden"></div>
      <div class="ah-progress hidden"><div class="ah-progress-bar"><div class="ah-progress-fill"></div></div><span class="ah-progress-text">Fetching…</span></div>
      <div class="ah-summary hidden">
        <div class="ah-stat-grid">
          <article class="ah-stat"><span class="ah-stat-label">DP Spent</span><strong class="ah-stat-dp-spent">—</strong><span class="ah-stat-shop-meta"></span></article>
          <article class="ah-stat"><span class="ah-stat-label">DP Purchased</span><strong class="ah-stat-dp-bought">—</strong><span class="ah-stat-usd-meta"></span></article>
          <article class="ah-stat"><span class="ah-stat-label">Total Orders</span><strong class="ah-stat-total">—</strong></article>
        </div>
        <details class="ah-breakdown"><summary>Gateway breakdown</summary>
          <table class="ah-gateway-table"><thead><tr><th>Method</th><th>Orders</th><th>DP</th><th>USD</th></tr></thead><tbody></tbody></table>
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
      <footer class="ah-footer hidden"><span class="ah-list-count"></span></footer>
    </div>`;
  }

  function createPanel(root, { onRefresh }) {
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
      exportGroup: root.querySelector(".ah-export-group"),
      exportCsv: root.querySelector(".ah-export-csv"),
      exportHtml: root.querySelector(".ah-export-html"),
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

    let orders = [], stats = null, activeFilter = "all", searchQuery = "";
    const show = (el) => el.classList.remove("hidden");
    const hide = (el) => el.classList.add("hidden");

    function setError(message) {
      if (!message) { hide(els.error); els.error.textContent = ""; return; }
      els.error.textContent = message;
      show(els.error);
    }

    function renderSummary() {
      if (!stats) return;
      els.statShopDp.textContent = formatNumber(stats.shopDp);
      els.statShopOrders.textContent = `${formatNumber(stats.shopOrders)} shop orders · ${formatNumber(stats.shopVp)} VP`;
      els.statPurchasedDp.textContent = formatNumber(stats.purchasedDp);
      let usdText = formatUsd(stats.purchasedUsd);
      if (stats.untrackedOrders) usdText += ` (+~${formatUsd(stats.estimatedMissingUsd).slice(1)} est.)`;
      els.statPurchasedUsd.textContent = usdText;
      els.statTotal.textContent = formatNumber(stats.totalOrders);
      els.gatewayTable.innerHTML = Object.entries(stats.byGateway)
        .sort((a, b) => b[1].dp - a[1].dp || a[0].localeCompare(b[0]))
        .map(([name, row]) => `<tr><td>${escapeHtml(name)}</td><td>${row.orders}</td><td>${formatNumber(row.dp)}</td><td>${formatUsd(row.usd)}</td></tr>`)
        .join("");
      const notes = [];
      if (stats.untrackedOrders) notes.push(`${stats.untrackedOrders} older orders missing USD in API (~${formatNumber(stats.untrackedDp)} DP estimated).`);
      if (stats.unpurchasedGap > 0) notes.push(`${formatNumber(stats.unpurchasedGap)} DP gap likely from promos/bonuses.`);
      else if (stats.unpurchasedGap < 0) notes.push(`${formatNumber(-stats.unpurchasedGap)} DP unused balance.`);
      if (stats.cryptoOrders) notes.push(`Crypto: ${stats.cryptoOrders} orders, ${formatNumber(stats.cryptoDp)} DP, ${formatUsd(stats.cryptoUsd)}.`);
      els.breakdownNotes.textContent = notes.join(" ");
    }

    function orderMatchesFilter(order) {
      if (activeFilter !== "all" && String(order.type) !== activeFilter) return false;
      if (!searchQuery) return true;
      return [orderDescription(order), (order.data || {}).name, formatDate(order.created_at), typeLabel(order.type), shopItems(order).join(" ")]
        .join(" ").toLowerCase().includes(searchQuery);
    }

    function renderOrder(order) {
      const type = Number(order.type);
      const dp = orderDpAmount(order), vp = orderVpAmount(order), char = (order.data || {}).name;
      let amountHtml = "";
      if (type === 0) {
        if (dp) amountHtml += `<span class="ah-dp ah-dp-spent">-${formatNumber(dp)} DP</span>`;
        if (vp) amountHtml += `<span class="ah-vp">${formatNumber(vp)} VP</span>`;
        if (!dp && !vp) amountHtml = `<span class="ah-vp">Free</span>`;
      } else if (type === 1) {
        amountHtml = `<span class="ah-dp">+${formatNumber(dp)} DP</span>`;
        const usd = orderUsdAmount(order);
        if (usd != null) amountHtml += `<span class="ah-usd">${formatUsd(usd, usdTracked(order) == null)}</span>`;
      }
      return `<article class="ah-order"><div class="ah-order-date">${formatDate(order.created_at)}</div><div class="ah-order-main"><div class="ah-order-title">${escapeHtml(orderDescription(order))}</div><div class="ah-order-meta"><span class="ah-badge ${type === 0 ? "ah-badge-shop" : "ah-badge-purchase"}">${typeLabel(type)}</span>${char ? ` · ${escapeHtml(char)}` : ""}</div></div><div class="ah-order-amounts">${amountHtml}</div></article>`;
    }

    function getFilteredOrders() {
      return orders.filter(orderMatchesFilter);
    }

    function renderList() {
      const filtered = getFilteredOrders();
      els.list.innerHTML = filtered.length
        ? filtered.map(renderOrder).join("")
        : `<div class="ah-empty">No transactions match your filter.</div>`;
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
      els.status.textContent = payload.cachedAt
        ? `Cached · ${formatDate(payload.cachedAt)}`
        : `Updated · ${formatNumber(payload.total)} orders`;
      renderAll();
      show(els.exportGroup);
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
    els.exportCsv.addEventListener("click", () => {
      const filtered = getFilteredOrders();
      if (!filtered.length) return;
      downloadOrdersCsv(filtered);
    });
    els.exportHtml.addEventListener("click", () => {
      const filtered = getFilteredOrders();
      if (!filtered.length) return;
      downloadOrdersHtml(filtered);
    });

    return {
      setError, applyPayload,
      setStatus(text) { els.status.textContent = text; },
      setProgress({ page, lastPage }) {
        els.progressFill.style.width = `${Math.round((page / lastPage) * 100)}%`;
        els.progressText.textContent = `Fetching page ${page} of ${lastPage}…`;
      },
      showProgress() { show(els.progress); },
      hideProgress() { hide(els.progress); },
      setRefreshing(active) { els.refresh.disabled = active; },
    };
  }

  async function loadCachedOrders() {
    const cached = await chrome.storage.local.get(CACHE_KEY);
    const payload = cached[CACHE_KEY];
    if (!payload?.orders?.length) return null;
    return { orders: payload.orders, cachedAt: payload.fetchedAt, total: payload.orders.length };
  }

  function connectOrdersRefresh({ onProgress, onDone, onError }) {
    const port = chrome.runtime.connect({ name: "orders" });
    port.onMessage.addListener((message) => {
      if (message.type === "progress") onProgress?.(message);
      if (message.type === "done") onDone?.(message.payload);
      if (message.type === "error") onError?.(message);
    });
    port.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError) onError?.({ error: chrome.runtime.lastError.message });
    });
    return {
      refresh(force = false) { port.postMessage({ type: "refresh", force }); },
      disconnect() { port.disconnect(); },
    };
  }

  globalThis.__AscensionHistory = { createPanel, loadCachedOrders, connectOrdersRefresh };
})();
