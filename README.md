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
