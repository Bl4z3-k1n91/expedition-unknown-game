import { json, redis, redisEnabled } from "./_gateway.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST required" });
  if (!redisEnabled()) return json(res, 409, { error: "Redis is required for fleet heartbeats" });
  if (!process.env.FLEET_HEARTBEAT_SECRET || req.headers["x-fleet-key"] !== process.env.FLEET_HEARTBEAT_SECRET) return json(res, 401, { error: "unauthorized fleet" });
  const fleet = String(req.body?.fleet || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!fleet) return json(res, 400, { error: "fleet required" });
  await redis("set", `arcade:fleet:${fleet}:heartbeat`, String(Date.now()), "EX", "15");
  return json(res, 200, { ok: true, fleet });
}
