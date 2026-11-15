import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleCalendar } from "../src/calendar.js";

const ENV = { PLANNING_CENTER_CLIENT_ID: "id", PLANNING_CENTER_SECRET: "secret" };

const PCO_BASE =
  "https://api.planningcenteronline.com/calendar/v2/event_instances?filter=future&order=starts_at&per_page=100&include=event,tags";
const PAGE2_URL =
  "https://api.planningcenteronline.com/calendar/v2/event_instances?filter=future&order=starts_at&per_page=100&include=event%2Ctags&page=2";

function instance(id, eventId, tagIds, startsAt) {
  return {
    id: String(id),
    type: "EventInstance",
    attributes: {
      starts_at: startsAt,
      ends_at: startsAt,
      all_day_event: false,
      location: "Room " + id,
      recurrence_description: "",
      church_center_url: "https://example.com/" + id,
    },
    relationships: {
      event: { data: { id: String(eventId), type: "Event" } },
      tags: { data: tagIds.map((t) => ({ id: String(t), type: "Tag" })) },
    },
  };
}

function eventRow(id, name, visible) {
  return {
    id: String(id),
    type: "Event",
    attributes: { name, visible_in_church_center: visible, description: name + " desc" },
  };
}

function tagRow(id, name) {
  return { id: String(id), type: "Tag", attributes: { name } };
}

let fetchCount;
let pages;

function makeCacheStore() {
  const m = new Map();
  return {
    async match(key) {
      const k = key instanceof Request ? key.url : String(key);
      const v = m.get(k);
      return v ? v.clone() : undefined;
    },
    async put(key, val) {
      m.set(key instanceof Request ? key.url : String(key), val.clone());
    },
  };
}

beforeEach(() => {
  globalThis.caches = { default: makeCacheStore() };
  fetchCount = 0;
  pages = new Map();
  globalThis.fetch = async (input) => {
    const u = String(input instanceof Request ? input.url : input);
    if (u.includes("planningcenteronline.com")) {
      fetchCount++;
      if (pages.has(u))
        return new Response(JSON.stringify(pages.get(u)), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      throw new Error("unexpected PCO fetch (leak!): " + u);
    }
    throw new Error("unexpected network fetch (leak!): " + u);
  };
});

describe("calendar", () => {
  it("two different tag/month queries trigger only ONE PCO fetch", async () => {
    pages.set(PCO_BASE, {
      data: [
        instance("1", "10", ["20"], "2026-11-20T10:00:00Z"),
        instance("2", "11", ["21"], "2026-12-21T10:00:00Z"),
      ],
      included: [
        eventRow("10", "Youth Night", true),
        eventRow("11", "Men's Breakfast", true),
        tagRow("20", "Youth Events"),
        tagRow("21", "Men's Events"),
      ],
    });
    const r1 = await handleCalendar(
      new Request("https://centergilbert.com/api/calendar?tag=Youth%20Events"),
      ENV,
      {}
    );
    assert.equal(r1.status, 200);
    const b1 = await r1.json();
    assert.equal(b1.events.length, 1);
    assert.equal(b1.events[0].name, "Youth Night");

    const r2 = await handleCalendar(
      new Request("https://centergilbert.com/api/calendar?tag=Men%27s%20Events&month=2026-12"),
      ENV,
      {}
    );
    assert.equal(r2.status, 200);
    const b2 = await r2.json();
    assert.equal(b2.events.length, 1);
    assert.equal(b2.events[0].name, "Men's Breakfast");

    assert.equal(fetchCount, 1);
  });

  it("merges paginated PCO payloads and excludes hidden events", async () => {
    pages.set(PCO_BASE, {
      data: [instance("1", "10", ["20"], "2026-11-20T10:00:00Z")],
      included: [eventRow("10", "Visible One", true), tagRow("20", "Youth Events")],
      links: { next: PAGE2_URL },
    });
    pages.set(PAGE2_URL, {
      data: [
        instance("2", "11", [], "2026-11-21T10:00:00Z"),
        instance("3", "12", [], "2026-11-22T10:00:00Z"),
      ],
      included: [eventRow("11", "Visible Two", true), eventRow("12", "Hidden Meeting", false)],
    });
    const res = await handleCalendar(new Request("https://centergilbert.com/api/calendar"), ENV, {});
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(fetchCount, 2);
    assert.equal(body.total_all, 2);
    assert.deepEqual(
      body.events.map((e) => e.name).sort(),
      ["Visible One", "Visible Two"]
    );
  });

  it("without credentials returns 502", async () => {
    const res = await handleCalendar(new Request("https://centergilbert.com/api/calendar"), {}, {});
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.ok(body.error.includes("Calendar"), JSON.stringify(body));
  });
});
