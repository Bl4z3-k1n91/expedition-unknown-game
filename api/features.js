import { clean, json } from "./_gateway.js";
import { assignment } from "./_event.js";
import { verifyAnalysisState } from "./analyze.js";
import { packState } from "./_state.js";

const round = value => Number(value.toFixed(1));

const weightForFeature = feature => {
  const strength = String(feature?.intended_strength || "weak").toLowerCase();
  if (strength === "strong") return 2;
  if (strength === "moderate") return 1;
  return 0;
};

export default function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST required" });
  const room = clean(req.body?.room, 16), player = clean(req.body?.player, 20);
  const selected = Array.isArray(req.body?.features) ? req.body.features.map(value => clean(value, 48)) : [];
  if (!room || !player || selected.length !== 10 || new Set(selected).size !== 10) return json(res, 400, { error: "Lock exactly 10 unique telemetry channels." });
  const event = assignment(room);
  if (selected.some(feature => !event.features.includes(feature))) return json(res, 400, { error: "The channel set contains an invalid feature." });
  try {
    const ledger = verifyAnalysisState(req.body?.analysisState, room, player);
    const strongCount = selected.filter(feature => event.featureStrength[feature]?.intended_strength === "strong").length;
    const moderateCount = selected.filter(feature => event.featureStrength[feature]?.intended_strength === "moderate").length;
    const weakCount = selected.filter(feature => event.featureStrength[feature]?.intended_strength === "weak").length;
    const pointsEarned = strongCount * 2 + moderateCount;
    const maxPoints = 20;
    const score = round((pointsEarned / maxPoints) * 100);
    const investigationTypes = new Set(ledger.purchases.map(key => key.split(":")[1])).size;
    const investigation = Math.min(100, investigationTypes * 15 + ledger.spent * 4);
    const components = { channelStrength: pointsEarned * 10, investigation };
    const featureState = packState("features", {
      room,
      player,
      selected,
      score,
      strongCount,
      moderateCount,
      weakCount,
      pointsEarned,
      maxPoints,
      spent: ledger.spent
    });
    return json(res, 200, {
      locked: true,
      selected,
      score,
      strongCount,
      moderateCount,
      weakCount,
      pointsEarned,
      maxPoints,
      components,
      spent: ledger.spent,
      featureState,
      message: `Feature Hunt sealed: ${strongCount} strong, ${moderateCount} moderate, ${weakCount} weak channels. Feature quality score ${score}/100.`
    });
  } catch (error) {
    return json(res, 409, { error: "The investigation ledger could not be verified. Reload the mission." });
  }
}
