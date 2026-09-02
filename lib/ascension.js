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
