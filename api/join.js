import { allocationId, clean, fleets, json, memoryLoads, redis, redisEnabled, rendezvousScore, ticket } from "./_gateway.js";

async function fleetState(shard) {
  if (!redisEnabled()) return { ...shard, healthy: true, load: memoryLoads.get(shard.id) ?? 0 };
  const [heartbeat, rawLoad] = await Promise.all([
    redis("get", `arcade:fleet:${shard.id}:heartbeat`),
    redis("zcard", `arcade:fleet:${shard.id}:reservations`)
  ]);
  return { ...shard, healthy: Number(heartbeat) > Date.now() - 15_000, load: Number(rawLoad ?? 0) };
}

async function reserve(shard, id) {
  if (!redisEnabled()) {
    const current = memoryLoads.get(shard.id) ?? 0;
    if (current >= shard.capacity) return null;
    memoryLoads.set(shard.id, current + 1);
    return current + 1;
  }
  // Removes stale leases, checks capacity, then reserves a 30-second handshake slot atomically.
  const script = "redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[1]);local n=redis.call('ZCARD',KEYS[1]);if n>=tonumber(ARGV[2]) then return -1 end;redis.call('ZADD',KEYS[1],ARGV[3],ARGV[4]);return n+1";
  const now = Date.now();
  const count = Number(await redis("eval", script, "1", `arcade:fleet:${shard.id}:reservations`, String(now), String(shard.capacity), String(now + 30_000), id));
  return count < 0 ? null : count;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST required" });
  const room = clean(req.body?.room, 16);
  const player = clean(req.body?.player, 20);
  if (!room || !player) return json(res, 400, { error: "room and player are required" });
  if (redisEnabled() && !process.env.MATCH_GATEWAY_SECRET) return json(res, 500, { error: "MATCH_GATEWAY_SECRET is required in production" });
  try {
    const states = await Promise.all(fleets().map(fleetState));
    const ordered = states.filter(s => s.healthy && s.load < s.capacity).sort((a, b) => rendezvousScore(a, `${room}:${player}`, a.load) - rendezvousScore(b, `${room}:${player}`, b.load));
    for (const shard of ordered) {
      const reservationId = allocationId();
      const seat = await reserve(shard, reservationId);
      if (seat === null) continue;
      const expiresAt = Math.floor(Date.now() / 1000) + 30;
      const joinTicket = ticket({ sub: player, room, shard: shard.id, reservationId, exp: expiresAt, aud: "switchyard-game" });
      return json(res, 200, {
        assignment: { shard: shard.id, region: shard.region, room, player, seat, reservationId, connectUrl: shard.connectUrl, expiresAt },
        ticket: joinTicket,
        router: "weighted rendezvous routing with lease-based admission",
        shards: states.map(({ id, region, capacity, healthy, load, weight }) => ({ id, region, capacity, healthy, weight, load: id === shard.id ? seat : load }))
      });
    }
    return json(res, 503, { error: "All healthy game fleets are at capacity. Try again shortly." });
  } catch (error) { return json(res, 502, { error: "Lobby router temporarily unavailable", detail: error.message }); }
}
