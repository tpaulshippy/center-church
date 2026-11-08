# Planning Center integration

The site pulls live data from Planning Center (PCO) through the Cloudflare
Worker (`worker.js`). The PCO credential is a personal access token used with
HTTP Basic auth (`CLIENT_ID` as username, secret as password).

## Rules

- The token lives ONLY in `~/shared_config` (outside the repo) and in
  Cloudflare runtime secrets. Never commit it, never ship it client-side.
- The browser must never call `api.planningcenteronline.com` directly.
  All PCO access goes through worker endpoints (`/api/*`), which hold the
  secret in `env` (`PLANNING_CENTER_CLIENT_ID`, `PLANNING_CENTER_SECRET`).
- Set secrets with `wrangler secret put <NAME>` (value via stdin pipe so it
  never appears in `ps`), or Dashboard → Workers → center-church →
  Settings → Variables and Secrets. Secrets take effect without a redeploy.
- Before uploading, verify values are non-empty (length check). The dashboard
  shows "Value encrypted" even for an empty secret — a previous outage was
  exactly that (empty value → "credentials not configured").
- The repo's variable names are `PLANNING_CENTER_CLIENT_ID` /
  `PLANNING_CENTER_SECRET`. Note `~/shared_config` may use slightly different
  names — map them explicitly when uploading, don't assume.

## What the token can do

- Read: People (as the token owner), Services, Calendar, Groups,
  Registrations, Publishing. Giving and Check-Ins return 401 — no access.
- Calendar: list upcoming instances via
  `GET /calendar/v2/event_instances?filter=future&order=starts_at&per_page=100&include=event,tags`.
  Only publish events whose Event has `visible_in_church_center === true`.
  Real tag vocabulary: All Church Events, Children/Family Events,
  Men's Events, Women's Events, Youth Events, Young Adults Events.
- Publishing Pages: reads + creates work via the public API (verified
  2026-11-05: `POST /publishing/v2/pages` returns 201). `PUT`/`PATCH`/`DELETE`
  return 403 on both `api.` and `~api` hosts — to change a page, `POST` a new
  version with the same slug (each save creates a NEW draft row; the UI shows
  the latest per slug, so delete spare rows via the UI).
  Publishing a draft works via the API too (verified 2026-11-08):
  `POST /publishing/v2/pages/{id}/publish` with the PAT returns 201 and the
  draft row is superseded by the published version.
  (see planningcenter/developers#1480).
- The `~api` host (`https://publishing.planningcenteronline.com/~api/...`)
  accepts the same PAT over HTTP Basic (verified: GET 200, POST 201) — no
  browser session cookie or CSRF token needed for automation. The block-editor
  UI itself uses cookie + CSRF, but API scripts should just use the PAT
  against either host.

## Worker conventions (see worker.js)

- One handler per `/api/*` route, `try/catch` returning the shared
  `feedError(err, Label)` 502 JSON on failure (`{error, detail}`).
- Cache JSON in `caches.default`; key on the full request URL when the
  response varies by query param; guard cached parses with
  `Array.isArray(...)` (empty results are valid — refetching them is a bug).
- PCO HTML descriptions must be stripped server-side (`cleanText`, already
  in worker.js) — the pages escape output, so raw HTML would render as
  literal tags.
- Test locally with `wrangler dev` + a temporary `.dev.vars` file
  (never `--var` CLI flags — values leak into `ps`). Delete `.dev.vars`
  after. Kill leftover `wrangler`/`workerd` processes by PID, never with a
  `pkill -f` pattern that can match your own shell.
- Bust caches when verifying: unique query strings; worker cache TTL is
  300s and error responses are `no-store` but edge may hold them briefly.

## Deploy

Push to `main` triggers the GitHub Action (`wrangler deploy`). The Action
uses its own repo secrets and deploys to the same account — verify with
`wrangler deployments list` (don't trust truncated output) and by curling
the live endpoint, not by assuming.
