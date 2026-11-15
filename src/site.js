import { logApp } from "./logging.js";

// Short links for small groups: centergilbert.com/go/<slug> -> Church Center group.
export const GROUP_SHORT_LINKS = {
  "shippy": "https://centerchurchgilbert.churchcenter.com/groups/small-groups/3227922",
  "rosado": "https://centerchurchgilbert.churchcenter.com/groups/small-groups/3286045",
  "ebright": "https://centerchurchgilbert.churchcenter.com/groups/small-groups/3286063",
  "hill": "https://centerchurchgilbert.churchcenter.com/groups/small-groups/3286066",
  "hubek": "https://centerchurchgilbert.churchcenter.com/groups/small-groups/3286068",
  "landis": "https://centerchurchgilbert.churchcenter.com/groups/small-groups/2672005",
  "fowler": "https://centerchurchgilbert.churchcenter.com/groups/small-groups/3286070",
  "senior": "https://centerchurchgilbert.churchcenter.com/groups/small-groups/3286071",
  "caregiver": "https://centerchurchgilbert.churchcenter.com/groups/small-groups/3286072",
  "recovery": "https://centerchurchgilbert.churchcenter.com/groups/small-groups/3286073",
  "welcome": "https://centergilbert.com/connect",
};

export async function handleSite(request, env) {
  const url = new URL(request.url);
  // Short link for staff: centergilbert.com/add-sermon -> Spotify for Creators episodes.
  if (url.pathname === "/add-sermon" || url.pathname === "/add-sermon/") {
    return Response.redirect(
      "https://creators.spotify.com/pod/show/4bPRAwHcRw08NO9uQWWtty/episodes",
      302
    );
  }
  // Email signup has no standalone form; contact holds the email + App messaging flow.
  if (url.pathname === "/email-signup" || url.pathname === "/email-signup/") {
    return Response.redirect(new URL("/contact", request.url).toString(), 302);
  }
  // Short links for small groups: centergilbert.com/go/<slug> -> Church Center group.
  if (url.pathname.startsWith("/go/")) {
    const slug = url.pathname.slice(4).replace(/\/$/, "").toLowerCase();
    const target = Object.prototype.hasOwnProperty.call(GROUP_SHORT_LINKS, slug)
      ? GROUP_SHORT_LINKS[slug]
      : undefined;
    if (target) {
      return Response.redirect(target, 302);
    }
  }
  // Clean URL for the internal upload guide (serves public/add-sermon-guide.html).
  if (url.pathname === "/add-sermon-guide" || url.pathname === "/add-sermon-guide/") {
    return env.ASSETS.fetch(
      new Request(new URL("/add-sermon-guide.html", request.url), request)
    );
  }
  const res = await env.ASSETS.fetch(request);

  // Serve our custom 404 page for unknown paths (but leave real assets alone).
  if (res.status === 404 && !url.pathname.includes(".")) {
    logApp(env, "404", url.pathname, "", url.hostname);
    const notFound = await env.ASSETS.fetch(
      new Request(new URL("/404", request.url), request)
    );
    if (notFound.ok) {
      return new Response(await notFound.text(), {
        status: 404,
        headers: { "content-type": "text/html;charset=UTF-8" },
      });
    }
  }
  if (res.status === 404 && url.pathname.includes(".")) {
    logApp(env, "404", url.pathname, "", url.hostname);
  }
  return res;
}
