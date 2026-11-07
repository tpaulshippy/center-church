// INACTIVE — to activate, add route hub.centergilbert.com/* in Cloudflare dashboard
// or wrangler config after DNS is owned. This file is staged only; it is not
// wired into worker.js, wrangler.jsonc routes, or public/ pages.

// Replace after the Spotify import with the real show RSS URL.
// Can also be supplied as a Worker secret/env var SPOTIFY_RSS_URL (env wins).
const SPOTIFY_RSS_URL_FALLBACK = "https://anchor.fm/s/REPLACE_ME/podcast/rss";

const CHURCH_CENTER = "https://centerchurchgilbert.churchcenter.com";
const SITE = "https://centergilbert.com";

const EXACT = new Map([
  ["/", `${CHURCH_CENTER}/home`],
  ["/give", `${CHURCH_CENTER}/giving`],
  ["/calendar", `${CHURCH_CENTER}/calendar`],
  ["/sign-ups", `${CHURCH_CENTER}/registrations/events`],
  ["/choose-a-small-group", `${CHURCH_CENTER}/registrations/events`],
  ["/im-new", `${SITE}/visit/`],
  ["/ministries", `${SITE}/get-connected/`],
  ["/men-amp-women", `${SITE}/get-connected/`],
  ["/children", `${SITE}/get-connected/`],
  ["/youth", `${SITE}/get-connected/`],
  ["/young-adult", `${SITE}/get-connected/`],
  ["/mens-conference", `${CHURCH_CENTER}/calendar`],
]);

function normalizePath(pathname) {
  const lower = pathname.toLowerCase();
  if (lower.length > 1 && lower.endsWith("/")) return lower.slice(0, -1);
  return lower;
}

function withQuery(target, search) {
  return search ? `${target}${search}` : target;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);

    if (path === "/media/podcast/30626/feed.rss") {
      const rss = env?.SPOTIFY_RSS_URL || SPOTIFY_RSS_URL_FALLBACK;
      return Response.redirect(withQuery(rss, url.search), 301);
    }

    if (path === "/media" || path.startsWith("/media/")) {
      return Response.redirect(withQuery(`${SITE}/sermons/`, url.search), 301);
    }

    if (EXACT.has(path)) {
      return Response.redirect(withQuery(EXACT.get(path), url.search), 301);
    }

    return Response.redirect(withQuery(`${SITE}/`, url.search), 301);
  },
};
