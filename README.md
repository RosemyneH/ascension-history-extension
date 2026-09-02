# Ascension Transaction History

Chrome extension that shows your full [Ascension.gg](https://ascension.gg) billing history — DP spent, DP purchased, USD totals, and a searchable transaction list.

It reads your existing browser session (no cookie copy/paste) and adds a **Transaction History** button on your account overview page.

## Features

- **Overview button** — opens your full history inline on `ascension.gg/.../user/overview`
- **Summary stats** — DP spent, DP purchased, gateway breakdown
- **Search & filters** — All / Shop / Purchases
- **Export CSV** — download the current filtered list
- **Standalone tab** — click the extension icon for a full-page view
- **Local cache** — shows cached data instantly, refreshes in the background

## Install (developer / unpacked)

1. Download or clone this repo
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the `ascension-history-extension` folder

## Use

1. Log in at [ascension.gg](https://ascension.gg) in the same browser
2. Open your account overview: `https://ascension.gg/en/user/overview`
3. Click **Transaction History** in the overview sidebar area
4. Click **↻** inside the panel to force a fresh fetch from the API

You can also click the extension toolbar icon to open the history in a regular browser tab.

## How it works

The extension uses the same Ascension API as the website:

```
GET https://api.ascension.gg/api/v3/billing/order-history?page=N
```

It classifies orders the same way as the included Python report logic:

| Type | Meaning |
|------|---------|
| `0` | Shop purchase — sums `data.price.dp` / `data.price.vp` |
| `1` | DP purchase — sums `data.add_dp` or `data.change_dp.diff` |

Payment methods are mapped from `gateway`, `ref_type`, and `paypal` fields.

## Permissions

| Permission | Why |
|------------|-----|
| `cookies` | Read your `ascension_token` session cookie |
| `storage` | Cache order history locally |
| `tabs` | Open/focus the standalone history tab |
| `ascension.gg` / `api.ascension.gg` | Fetch order history and inject the overview panel |

No data is sent anywhere except `api.ascension.gg`. Nothing leaves your browser.

## Python alternative

A standalone Python report script with the same analysis logic is available separately. This extension is the browser-native version — no terminal or manual cookie copying required.

## Troubleshooting

**Button doesn't appear on overview**
- Reload the extension at `chrome://extensions`
- Hard-refresh the overview page
- Confirm you're logged in at ascension.gg

**Auth failed / not logged in**
- Visit ascension.gg and log in
- Refresh the overview page
- Click ↻ in the panel

**`ERR_FILE_NOT_FOUND` on extension tab**
- Remove and re-load the unpacked extension
- Make sure you selected the folder that contains `manifest.json`

## License

MIT
