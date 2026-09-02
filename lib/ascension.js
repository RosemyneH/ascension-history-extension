const API = "https://api.ascension.gg/api/v3/billing/order-history";
const DELAY_MS = 120;

const GATEWAYS = {
  0: "Credit card",
  1: "PayPal",
  2: "Paymentwall",
  3: "Prepaid card",
  4: "Coinbase",
  5: "Crypto",
  6: "TBank",
  7: "Cryptomus",
};

const CRYPTO_GATEWAYS = new Set([4, 5, 7]);

const DP_TIER_USD = {
  3: 1, 9: 1, 18: 5, 36: 10, 58: 15, 63: 15, 96: 25, 105: 25,
  135: 35, 147: 35, 192: 50, 390: 100, 510: 100, 786: 200, 1974: 500,
  30: 10, 33: 10, 55: 15, 77: 25, 110: 35, 225: 50, 455: 100,
  2: 1, 5: 1, 10: 3, 20: 7, 42: 15, 60: 20,
};

const ORDER_TYPES = {
  0: "Shop",
  1: "DP Purchase",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getCookieString() {
  const cookies = await chrome.cookies.getAll({ domain: ".ascension.gg" });
  if (!cookies.length) {
    const alt = await chrome.cookies.getAll({ url: "https://ascension.gg" });
    if (!alt.length) return "";
    return alt.map((c) => `${c.name}=${c.value}`).join("; ");
  }
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

function apiHeaders(cookie) {
  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "en",
    cookie,
    origin: "https://ascension.gg",
    referer: "https://ascension.gg/",
    "x-ascension-cookie-auth": "true",
  };
}

async function fetchPage(cookie, page) {
  const res = await fetch(`${API}?page=${page}`, { headers: apiHeaders(cookie) });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.body = body.slice(0, 300);
    throw err;
  }
  return res.json();
}

export async function fetchAllOrders(cookie, onProgress) {
  const first = await fetchPage(cookie, 1);
  const orders = [...(first.data || [])];
  const lastPage = Number(first.last_page || 1);

  onProgress?.({ page: 1, lastPage, total: first.total });

  for (let page = 2; page <= lastPage; page++) {
    await sleep(DELAY_MS);
    const payload = await fetchPage(cookie, page);
    orders.push(...(payload.data || []));
    onProgress?.({ page, lastPage, total: first.total });
  }

  orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { orders, total: first.total, lastPage };
}

export function gatewayId(order) {
  const data = order.data || {};
  if (order.paypal) return 1;
  if (data.gateway != null) return Number(data.gateway);
  if (order.ref_type != null) return Number(order.ref_type);
  return null;
}

export function gatewayName(order) {
  const gid = gatewayId(order);
  if (gid == null) return "Unknown";
  return GATEWAYS[gid] || `Unknown (id ${gid})`;
}

export function dpAdded(order) {
  const data = order.data || {};
  if (data.add_dp != null) return Number(data.add_dp || 0);
  const change = data.change_dp || {};
  return Number(change.diff || 0);
}

export function usdTracked(order) {
  const paypal = order.paypal;
  if (paypal) {
    const value = Number(paypal.value || 0);
    return value > 0 ? value : null;
  }
  const additional = (order.data || {}).additional || {};
  const raw = additional.payment_amount;
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  return value > 0 ? value : null;
}

export function shopItems(order) {
  const items = (order.data || {}).items || [];
  return items.map((row) => {
    const name = row.item?.name || `Item #${row.item_id}`;
    const qty = row.quantity || 1;
    return qty > 1 ? `${name} ×${qty}` : name;
  });
}

export function orderDescription(order) {
  const type = Number(order.type);
  if (type === 0) {
    const items = shopItems(order);
    const char = (order.data || {}).name;
    if (items.length) return items.join(", ");
    return char ? `Shop order (${char})` : "Shop order";
  }
  if (type === 1) {
    const added = dpAdded(order);
    return `+${added.toLocaleString()} DP via ${gatewayName(order)}`;
  }
  return `Order type ${type}`;
}

export function orderDpAmount(order) {
  const type = Number(order.type);
  if (type === 0) return Number((order.data?.price || {}).dp || 0);
  if (type === 1) return dpAdded(order);
  return 0;
}

export function orderVpAmount(order) {
  if (Number(order.type) !== 0) return 0;
  return Number((order.data?.price || {}).vp || 0);
}

export function orderUsdAmount(order) {
  if (Number(order.type) !== 1) return null;
  const tracked = usdTracked(order);
  if (tracked != null) return tracked;
  const added = dpAdded(order);
  return DP_TIER_USD[added] ?? null;
}

export function analyze(orders) {
  let shopDp = 0;
  let shopVp = 0;
  let shopOrders = 0;
  const typeCounts = {};
  const byGateway = {};
  let trackedUsd = 0;
  let estimatedUsd = 0;
  let untrackedOrders = 0;
  let untrackedDp = 0;

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
      const guess = DP_TIER_USD[added];
      if (guess) estimatedUsd += guess;
    }
  }

  const purchasedDp = Object.values(byGateway).reduce((sum, row) => sum + row.dp, 0);
  const trueSpend = trackedUsd + estimatedUsd;

  let cryptoDp = 0;
  let cryptoUsd = 0;
  let cryptoOrders = 0;
  for (const gid of CRYPTO_GATEWAYS) {
    const label = GATEWAYS[gid];
    if (!byGateway[label]) continue;
    cryptoDp += byGateway[label].dp;
    cryptoUsd += byGateway[label].usd;
    cryptoOrders += byGateway[label].orders;
  }

  return {
    totalOrders: orders.length,
    typeCounts,
    shopDp,
    shopVp,
    shopOrders,
    byGateway,
    purchasedDp,
    purchasedUsd: trackedUsd,
    estimatedMissingUsd: estimatedUsd,
    estimatedTrueSpend: trueSpend,
    untrackedOrders,
    untrackedDp,
    cryptoDp,
    cryptoUsd,
    cryptoOrders,
    unpurchasedGap: shopDp - purchasedDp,
  };
}

export function formatUsd(value, estimated = false) {
  if (value == null) return "—";
  const prefix = estimated ? "~" : "";
  return `${prefix}$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function typeLabel(type) {
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

export function ordersToCsv(orders) {
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

export function downloadOrdersCsv(orders, filename) {
  downloadBlob(ordersToCsv(orders), "text/csv;charset=utf-8", filename || exportFilename("csv"));
}

export function ordersToHtml(orders) {
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
    @media (max-width: 800px) {
      .stats { grid-template-columns: 1fr; }
      table { display: block; overflow-x: auto; }
    }
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
    <table>
      <thead><tr><th>Method</th><th>Orders</th><th>DP</th><th>USD</th></tr></thead>
      <tbody>${gatewayRows || '<tr><td colspan="4">No purchases</td></tr>'}</tbody>
    </table>
    <h2>Transactions</h2>
    <table>
      <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Character</th><th>DP</th><th>VP</th><th>USD</th><th>Gateway</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</body>
</html>`;
}

export function downloadOrdersHtml(orders, filename) {
  downloadBlob(ordersToHtml(orders), "text/html;charset=utf-8", filename || exportFilename("html"));
}
