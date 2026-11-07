# Center Church — Website

Redesigned website for **Center Church** (centergilbert.com), Gilbert, AZ.

- **Live:** https://centergilbert.tpaulshippy.com
- **Content:** ported from the current centergilbert.com (mission, values, beliefs,
  leadership, ministries, visit info, sermons).
- **Design:** heavily inspired by [thegardenaz.com](https://thegardenaz.com) —
  full-bleed hero photography, oversized display type, Sunday-times band,
  card grids, FAQ accordions.
- **Stack:** pure static HTML + CSS + a few lines of vanilla JS. No CMS,
  no backend, no React. Frequently updated pages (events, giving, groups)
  live in Planning Center and are linked via the Central Hub.

## Project layout

```
public/          static site (index, about, beliefs, leadership, connect, visit, sermons, contact)
worker.js        Cloudflare Worker — serves static assets + custom 404 page
wrangler.jsonc   Worker config (assets dir, custom-domain route)
.github/         GitHub Action: deploys to Cloudflare on every push to main
```

## Development

Edit files in `public/` and open them directly in a browser, or preview with:

```sh
npx wrangler dev
```

Pushing to `main` triggers the GitHub Action, which runs `wrangler deploy`
using the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repo secrets and
publishes to https://centergilbert.tpaulshippy.com via the
`centergilbert.tpaulshippy.com/*` worker route.

## Hub redirect (hub.centergilbert.com → Church Center) — INACTIVE

Staged-only: `hub-redirect.js` exports a standalone Worker fetch handler that
301-redirects old hub paths (Church Center, sermons, giving, calendar, etc.).
It is **not wired in** — `worker.js`, `wrangler.jsonc` routes, and `public/`
are untouched.

To activate (only after DNS for hub.centergilbert.com is owned):

1. Replace the `SPOTIFY_RSS_URL` placeholder in `hub-redirect.js` (currently
   `https://anchor.fm/s/REPLACE_ME/podcast/rss`) with the real show RSS URL
   after the Spotify import — or set a `SPOTIFY_RSS_URL` Worker secret/env var
   (env wins over the const).
2. Add route `hub.centergilbert.com/*` in the Cloudflare dashboard or wrangler
   config, pointing at a Worker running `hub-redirect.js`.
3. Curl-check a few paths (`/`, `/give`, `/media`, `/media/podcast/30626/feed.rss`,
   unknown slug) for 301s + preserved `?query` strings.
