import { clean, json } from "./_gateway.js";
import { assignment, MANUAL_CLASSES, manualClass } from "./_event.js";
import { packState } from "./_state.js";

export default function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST required" });
  const room = clean(req.body?.room, 16), player = clean(req.body?.player, 20), submitted = req.body?.labels || {};
  if (!room || !player) return json(res, 400, { error: "Room and player are required" });
  const event = assignment(room), expectedIds = new Set(event.manualRows.map(row => row.manual_id));
  if (Object.keys(submitted).some(id => !expectedIds.has(id) || (submitted[id] && !MANUAL_CLASSES.includes(submitted[id])))) {
    return json(res, 400, { error: "The manual ledger contains an invalid row or class." });
  }
  let correct = 0, wrong = 0, blank = 0;
  for (const row of event.manualRows) {
    const answer = submitted[row.manual_id] || "", truth = manualClass(row);
    if (!answer) blank++;
    else if (answer === truth) correct++;
    else wrong++;
  }
  const points = correct - wrong, score = Math.max(0, Number((points / event.manualRows.length * 100).toFixed(1)));
  const manualState = packState("manual", { room, player, correct, wrong, blank, points, score });
  return json(res, 200, {
    locked: true, correct, wrong, blank, points, possible: 50, score, manualState,
    message: `Manual Override sealed: ${correct} correct, ${wrong} wrong, ${blank} blank — ${points > 0 ? "+" : ""}${points}/50 points.`
  });
}
