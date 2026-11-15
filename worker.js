import { handleSermons, handleSermonSearch, handlePodcast, handlePodcastSearch } from "./src/sermons.js";
import { handleCalendar } from "./src/calendar.js";
import { handleSite } from "./src/site.js";
import { logApp } from "./src/logging.js";

export default {
  async fetch(request, env, ctx) {
    let url;
    try {
      url = new URL(request.url);
      if (url.pathname === "/api/sermons/search") {
        return handleSermonSearch(request, ctx);
      }
      if (url.pathname === "/api/sermons") {
        return handleSermons(request, ctx);
      }
      if (url.pathname === "/api/podcast/search") {
        return handlePodcastSearch(request, ctx);
      }
      if (url.pathname === "/api/podcast") {
        return handlePodcast(request, ctx);
      }
      if (url.pathname === "/api/calendar") {
        return handleCalendar(request, env, ctx);
      }
      return await handleSite(request, env);
    } catch (err) {
      let path = "/";
      try {
        path = (url && url.pathname) || new URL(request.url).pathname;
      } catch (_) {
        // leave default
      }
      logApp(env, "error", path, String((err && err.message) || err), url ? url.hostname : "");
      return new Response("Something went wrong", {
        status: 500,
        headers: { "content-type": "text/plain;charset=UTF-8", "cache-control": "no-store" },
      });
    }
  },
};
