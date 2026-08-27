import { clean, json } from "./_gateway.js";
import { randomUUID } from "node:crypto";

const pin = () => String(Math.floor(100000 + Math.random() * 900000));
const configured = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
const headers = () => ({ "Content-Type": "application/json", apikey: process.env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}` });
async function db(path, init = {}) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...headers(), ...init.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.message || body.hint || "Room database request failed"), { status: response.status });
  return body;
}
const expose = r => ({ pin: r.pin, status: r.status, missionSeed: r.mission_seed, players: r.players || [] });

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST required" });
  if (!configured()) return json(res, 503, { error: "Live rooms need Supabase configuration. Add SUPABASE_URL and SUPABASE_SECRET_KEY in Vercel." });
  const action = clean(req.body?.action, 12);
  try {
    if (action === "create") {
      for (let attempt = 0; attempt < 8; attempt++) {
        const row = { pin: pin(), host_token: randomUUID(), mission_seed: randomUUID(), status: "lobby", players: [], expires_at: new Date(Date.now() + 14_400_000).toISOString() };
        try { const created = await db("game_rooms", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) }); return json(res, 201, { room: expose(created[0] || created), hostToken: row.host_token }); }
        catch (error) { if (error.status !== 409) throw error; }
      }
      return json(res, 503, { error: "Could not reserve a room PIN. Try again." });
    }
    const roomPin = clean(req.body?.pin, 6); if (!roomPin) return json(res, 400, { error: "valid room PIN required" });
    if (action === "get") { const rows = await db(`game_rooms?pin=eq.${encodeURIComponent(roomPin)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=pin,status,mission_seed,players`); return rows.length ? json(res, 200, { room: expose(rows[0]) }) : json(res, 404, { error: "Room not found" }); }
    if (action === "join") { const name = clean(req.body?.player, 20); if (!name) return json(res, 400, { error: "player name required" }); const row = await db("rpc/join_game_room", { method: "POST", body: JSON.stringify({ room_pin: roomPin, player_name: name }) }); return json(res, 200, { room: expose(row) }); }
    if (action === "start") { const token = String(req.body?.hostToken || ""); const row = await db("rpc/start_game_room", { method: "POST", body: JSON.stringify({ room_pin: roomPin, host_token: token }) }); return json(res, 200, { room: expose(row) }); }
    return json(res, 400, { error: "unknown room action" });
  } catch (error) {
    const message = error.message.includes("ROOM_NOT_FOUND") ? "Room not found" : error.message.includes("GAME_STARTED") ? "This game has already started" : error.message.includes("HOST_ONLY") ? "Only the room host can start this game" : error.message;
    return json(res, error.status === 404 ? 404 : error.status === 403 ? 403 : 409, { error: message });
  }
}
