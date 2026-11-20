import { feedError } from "./feed.js";
import { logApp } from "./logging.js";

const MAX_PER_HOUR = 5;
const WINDOW_MS = 60 * 60 * 1000;
const MIN_FILL_MS = 3000;
const MAX_PRAYER_LEN = 2000;
const MAX_NAME_LEN = 80;

// In-memory per-IP sliding window. Per-isolate best-effort (no KV/D1).
const hitsByIp = new Map();

export function _resetPrayerRateLimit() {
  hitsByIp.clear();
}

function clientIp(request) {
  const cf = (request.headers.get("cf-connecting-ip") || "").trim();
  if (cf) return cf.slice(0, 80);
  const xff = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  if (xff) return xff.slice(0, 80);
  return "unknown";
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json;charset=UTF-8", "cache-control": "no-store" },
  });
}

function fakeSuccess() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json;charset=UTF-8", "cache-control": "no-store" },
  });
}

export async function handlePrayer(request, env) {
  try {
    if (request.method !== "POST") {
      return jsonError("Method not allowed", 405);
    }
    const ctype = request.headers.get("content-type") || "";
    if (!ctype.toLowerCase().includes("application/json")) {
      return jsonError("Expected application/json", 415);
    }
    let body;
    try {
      body = await request.json();
    } catch (_) {
      return jsonError("Invalid JSON body", 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonError("Invalid JSON body", 400);
    }

    // Honeypot: silently pretend success so bots learn nothing.
    const company = typeof body.company === "string" ? body.company.trim() : body.company ? String(body.company).trim() : "";
    if (company) return fakeSuccess();

    const nameRaw = body.name == null ? "" : body.name;
    if (typeof nameRaw !== "string") return jsonError("Name must be a string", 400);
    const name = nameRaw.trim();
    if (name.length > MAX_NAME_LEN) return jsonError("Name must be 80 characters or fewer", 400);

    const prayerRaw = body.prayer == null ? "" : body.prayer;
    if (typeof prayerRaw !== "string") return jsonError("Prayer request is required", 400);
    const prayer = prayerRaw.trim();
    if (!prayer.length) return jsonError("Prayer request is required", 400);
    if (prayer.length > MAX_PRAYER_LEN) return jsonError("Prayer request must be 2000 characters or fewer", 400);

    // Minimum form-fill time (client-supplied epoch ms). Absent/non-numeric: accept.
    const filledAt = body.filledAt;
    if (typeof filledAt === "number" && Number.isFinite(filledAt)) {
      if (Date.now() - filledAt < MIN_FILL_MS) {
        return jsonError("Please take a moment to write your request before sending", 429);
      }
    }

    // Per-IP sliding window: max 5/hour.
    const ip = clientIp(request);
    const now = Date.now();
    const hits = (hitsByIp.get(ip) || []).filter((t) => now - t < WINDOW_MS);
    if (hits.length >= MAX_PER_HOUR) {
      return jsonError("Too many prayer requests, please try again later", 429);
    }
    hits.push(now);
    hitsByIp.set(ip, hits);

    const apiKey = env && env.RESEND_API_KEY;
    if (!apiKey) {
      logApp(env, "error", "/api/prayer", "RESEND_API_KEY not configured", "");
      return jsonError("Prayer requests are temporarily unavailable", 503);
    }

    const text = "Name: " + (name || "Anonymous") + "\n\n" + prayer;
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Center Church Prayer <prayer@centergilbert.com>",
        to: ["info@centergilbert.com"],
        subject: "New prayer request",
        text,
      }),
    });
    if (!resendRes.ok) {
      throw new Error("resend status " + resendRes.status);
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json;charset=UTF-8", "cache-control": "no-store" },
    });
  } catch (err) {
    logApp(env, "error", "/api/prayer", String((err && err.message) || err), "");
    return feedError(err, "Prayer");
  }
}
