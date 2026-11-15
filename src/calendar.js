import { CALENDAR_API_TTL, feedError } from "./feed.js";
import { cleanText } from "./text.js";

export async function handleCalendar(request, env, ctx) {
  try {
    const id = env.PLANNING_CENTER_CLIENT_ID;
    const secret = env.PLANNING_CENTER_SECRET;
    if (!id || !secret) throw new Error("calendar credentials not configured");
    const url = new URL(request.url);
    const tagRaw = (url.searchParams.get("tag") || "").trim().slice(0, 60);
    const tag = tagRaw.toLowerCase();
    const monthParam = (url.searchParams.get("month") || "").trim();
    const month = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : "";
    const cache = caches.default;
    const key = new Request(url.toString(), request);
    const cached = await cache.match(key);
    if (cached) {
      const data = await cached.json();
      if (data && Array.isArray(data.events)) return new Response(JSON.stringify(data), {
        headers: {
          "content-type": "application/json;charset=UTF-8",
          "cache-control": "public, max-age=60, s-maxage=" + CALENDAR_API_TTL,
        },
      });
    }
    const apiRes = await fetch("https://api.planningcenteronline.com/calendar/v2/event_instances?filter=future&order=starts_at&per_page=100&include=event,tags", {
      headers: {
        "Authorization": "Basic " + btoa(id + ":" + secret),
        "Accept": "application/json",
        "user-agent": "CenterChurchSite/1.0 (+https://centergilbert.com)",
      },
    });
    if (!apiRes.ok) throw new Error("calendar status " + apiRes.status);
    const payload = await apiRes.json();
    const byId = new Map();
    const tagById = new Map();
    for (const inc of (payload && payload.included) || []) {
      if (!inc || !inc.id) continue;
      if (inc.type === "Event") byId.set(String(inc.id), inc);
      else if (inc.type === "Tag" && inc.attributes) tagById.set(String(inc.id), inc.attributes.name || "");
    }
    const events = [];
    const tagCounts = new Map();
    for (const inst of (payload && payload.data) || []) {
      const rel = inst && inst.relationships && inst.relationships.event && inst.relationships.event.data;
      const event = rel ? byId.get(String(rel.id)) : null;
      if (!event) continue;
      if (!event.attributes || event.attributes.visible_in_church_center !== true) continue;
      const ia = inst.attributes || {};
      const ea = event.attributes || {};
      const tagRels = (inst.relationships && inst.relationships.tags && inst.relationships.tags.data) || [];
      const tags = [];
      for (const tr of tagRels) {
        const name = tagById.get(String(tr && tr.id));
        if (name && !tags.includes(name)) tags.push(name);
      }
      for (const t of tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
      events.push({
        id: inst.id,
        name: ea.name || "",
        starts_at: ia.starts_at || null,
        ends_at: ia.ends_at || null,
        all_day_event: ia.all_day_event === true,
        location: ia.location || "",
        recurrence_description: ia.recurrence_description || "",
        church_center_url: ia.church_center_url || "",
        description: cleanText(ea.description || ea.summary || ""),
        tags,
      });
    }
    const facets = {
      tags: [...tagCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
    const filtered = events.filter((ev) => {
      if (tag && !ev.tags.some((t) => t.toLowerCase() === tag)) return false;
      if (month && !(ev.starts_at && ev.starts_at.slice(0, 7) === month)) return false;
      return true;
    });
    const data = { updated: new Date().toISOString(), total: filtered.length, total_all: events.length, tag: tagRaw, month, events: filtered, facets };
    const res = new Response(JSON.stringify(data), {
      headers: {
        "content-type": "application/json;charset=UTF-8",
        "cache-control": "public, max-age=60, s-maxage=" + CALENDAR_API_TTL,
      },
    });
    const put = cache.put(key, res.clone());
    if (ctx && ctx.waitUntil) ctx.waitUntil(put);
    else await put;
    return res;
  } catch (err) {
    return feedError(err, "Calendar");
  }
}
