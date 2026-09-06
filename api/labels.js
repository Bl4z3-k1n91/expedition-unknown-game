import { clean, json } from "./_gateway.js";
import { assignment, WILDLIFE_CLASSES } from "./_event.js";

export default function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST required" });
  const room = clean(req.body?.room, 16), submitted = req.body?.labels || {};
  if (!room) return json(res, 400, { error: "Room is required" });
  const event = assignment(room), expectedIds = event.unknown.map(row => row.id), keys = Object.keys(submitted);
  if (keys.length !== 50 || expectedIds.some(id => !WILDLIFE_CLASSES.includes(submitted[id]))) return json(res, 400, { error: "Classify all 50 camera-trap records using an approved class." });
  const correct = event.unknown.filter((row, index) => submitted[expectedIds[index]] === row.target).length;
  return json(res, 200, { locked: true, correct, total: 50, score: correct * 2, message: `Field labels locked: ${correct}/50 verified (${correct * 2}%). These labels now carry into model training.` });
}
