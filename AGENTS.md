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
- Publishing Pages: reads + creates work via the public API, but
  update/delete return 403 — PCO has no public Pages write API
  (see planningcenter/developers#1480). To edit a page's content you must
  either use the block-editor UI or replay the editor's internal API
  (see below).

## Editing a Publishing page via the editor's internal API

The block editor saves through `https://publishing.planningcenteronline.com/~api/...`,
authenticated with the browser session cookie + CSRF token (NOT the PAT):

1. In the browser, open devtools Network tab, make an edit, and copy the
   save request as curl. You need the `planning_center_session` cookie,
   `x-csrf-token`, and `x-pco-api-version: 2018-08-01` headers.
2. `GET /~api/publishing/v2/pages/<id>?include=draft_page_restrictions`
   verifies the session works.
3. Saves are `POST` to `/~api/publishing/v2/pages?...` with the full page
   payload (blocks with ids, slug, title). Each save creates a NEW draft
   row — it never updates in place. The UI collapses duplicates by slug
   (shows latest), but rows pile up; delete spares via the UI.
4. `PUT`/`PATCH`/`DELETE` do not work on pages through any API with this
   token (403), session cookie included. Only the collection-`POST`
   (create new version) path works.
5. Sessions/cookies expire — when calls start 401/403ing, capture a fresh
   curl. Treat the cookie like a password: never commit it.

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
