import { createHmac, randomUUID } from "node:crypto";

export const DEFAULT_FLEETS = [
  { id: "arc-01", weight: 5, region: "MUM", capacity: 60, connectUrl: "wss://mum1.example-game.net" },
  { id: "arc-02", weight: 3, region: "BLR", capacity: 48, connectUrl: "wss://blr1.example-game.net" },
  { id: "arc-03", weight: 2, region: "DEL", capacity: 40, connectUrl: "wss://del1.example-game.net" }
];
export const memoryLoads = new Map();
export const json = (res, status, body) => res.status(status).json(body);
export const clean = (value, max = 24) => String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, max);

export function fleets() {
  if (!process.env.GAME_FLEETS_JSON) return DEFAULT_FLEETS;
  const configured = JSON.parse(process.env.GAME_FLEETS_JSON);
  if (!Array.isArray(configured) || !configured.length) throw new Error("GAME_FLEETS_JSON must be a non-empty fleet array");
  return configured;
}
export function redisEnabled() { return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN); }
export async function redis(command, ...args) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const response = await fetch(`${url}/${command}/${args.map(encodeURIComponent).join("/")}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Redis ${command} failed`);
  return (await response.json()).result;
}
export function rendezvousScore(shard, playerKey, load) {
  let hash = 2166136261;
  for (const char of `${playerKey}:${shard.id}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const unit = ((hash >>> 0) + 1) / 4294967297;
  return -Math.log(unit) / shard.weight + (load / shard.capacity) * 0.35;
}
export function ticket(payload) {
  const secret = process.env.MATCH_GATEWAY_SECRET;
  if (!secret) return null;
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}
export function allocationId() { return randomUUID(); }
