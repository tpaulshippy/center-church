// Fire-and-forget Analytics Engine logging. Never throws (safe to call anywhere).
export function logApp(env, kind, path, detail, hostname) {
  try {
    if (!env || !env.APP_LOGS || typeof env.APP_LOGS.writeDataPoint !== "function") return;
    env.APP_LOGS.writeDataPoint({
      blobs: [kind, path, String(detail || "").slice(0, 200)],
      doubles: [1],
      indexes: [hostname || ""],
    });
  } catch (_) {
    // Logging must never break a request.
  }
}
