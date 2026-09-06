import { clean, json } from "./_gateway.js";
import { assignment, qualityLab, WILDLIFE_CLASSES } from "./_event.js";
import { correlation, stumpImportance, verifyAnalysisState } from "./analyze.js";

const validEvidence = (feature, rationale, purchases) => {
  const parsed = purchases.map(key => key.split(":")), forFeature = type => parsed.some(parts => parts[1] === type && parts.includes(feature));
  if (rationale === "predictive") return parsed.some(parts => parts[1] === "importance") || forFeature("classwise");
  if (rationale === "coverage") return forFeature("stats") || forFeature("missing");
  if (rationale === "independence") return parsed.some(parts => parts[1] === "correlation") || forFeature("relationship");
  if (rationale === "stability") return new Set(parsed.filter(parts => parts[1] === "stats" && parts.includes(feature)).map(parts => parts[0])).size >= 2;
  return false;
};
const round = value => Number(value.toFixed(1));

export default function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST required" });
  const room = clean(req.body?.room, 16), player = clean(req.body?.player, 20), selected = Array.isArray(req.body?.features) ? req.body.features.map(value => clean(value, 48)) : [], rationales = req.body?.rationales || {}, labels = req.body?.labels || {};
  if (!room || !player || selected.length !== 8 || new Set(selected).size !== 8) return json(res, 400, { error: "Submit exactly eight unique features." });
  const event = assignment(room);
  if (selected.some(feature => !event.features.includes(feature))) return json(res, 400, { error: "The dossier contains an invalid feature." });
  if (event.unknown.some(row => !WILDLIFE_CLASSES.includes(labels[row.id]))) return json(res, 409, { error: "The field-label ledger is incomplete." });
  try {
    const ledger = verifyAnalysisState(req.body?.analysisState, room, player), unsupported = selected.filter(feature => !validEvidence(feature, rationales[feature], ledger.purchases));
    if (unsupported.length) return json(res, 409, { error: `Attach a valid purchased-evidence rationale to: ${unsupported.join(", ")}.` });
    const rows = qualityLab(event).map((row, index) => index < 150 ? row : { ...row, target: labels[event.unknown[index - 150].id] });
    const gains = event.features.map(feature => ({ feature, gain: stumpImportance(rows, feature) })).sort((a, b) => b.gain - a.gain), best = gains.slice(0, 8).reduce((sum, item) => sum + item.gain, 0) || 1, chosen = gains.filter(item => selected.includes(item.feature)).reduce((sum, item) => sum + item.gain, 0);
    const missing = selected.reduce((sum, feature) => sum + rows.filter(row => row[feature] == null).length / rows.length, 0) / selected.length;
    const pairs = []; for (let i = 0; i < selected.length; i++) for (let j = i + 1; j < selected.length; j++) pairs.push(Math.abs(correlation(rows, selected[i], selected[j]) || 0));
    const types = new Set(ledger.purchases.map(key => key.split(":")[1])).size, cohorts = new Set(ledger.purchases.map(key => key.split(":")[0])).size;
    const components = { signal: round(Math.min(1, chosen / best) * 100), coverage: round((1 - missing) * 100), independence: round((1 - pairs.reduce((sum, value) => sum + value, 0) / pairs.length) * 100), investigation: Math.min(100, types * 15 + cohorts * 10) };
    const score = round(components.signal * .55 + components.coverage * .15 + components.independence * .15 + components.investigation * .15);
    return json(res, 200, { locked: true, score, components, selected, spent: ledger.spent, message: `Feature dossier locked at ${score}/100. These eight signals now control every model run.` });
  } catch (error) { return json(res, 409, { error: "The investigation ledger could not be verified. Reload the mission." }); }
}
