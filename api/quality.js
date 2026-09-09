import { clean, json } from "./_gateway.js";
import { assignment, hash } from "./_event.js";
import { packState, verifyState } from "./_state.js";

const COSTS = { missing: 3, outlier: 3, label: 1, duplicate: 2 };
const LIMITS = { missing: 3, outlier: 2, label: 6, duplicate: 4 };
const BUDGET = 15;
// This is a recovery route, not an alternate optimal build. Four or fewer
// strong channels means the locked selection cannot outperform the fixed backup.
export const EMERGENCY_MAX_STRONG_CHANNELS = 4;
export const EMERGENCY_QUALITY_SCORE = 35;
const unique = values => [...new Set(Array.isArray(values) ? values.map(value => String(value || "").slice(0, 64)) : [])];

export function buildQualityPlan(event, features, room = "fixed") {
  const logs = event.corruptionLog;
  const countBy = problem => features.map(feature => ({
    feature,
    issueCount: logs.filter(item => item.problem === problem && item.column === feature).length
  })).filter(item => item.issueCount).sort((a, b) => b.issueCount - a.issueCount || a.feature.localeCompare(b.feature));
  const damagedById = new Map(event.trainDamaged.map(row => [row.event_id, row]));
  const labelCandidates = logs.filter(item => item.problem === "wrong_label")
    .sort((a, b) => hash(`${room}:${a.event_id}:label`) - hash(`${room}:${b.event_id}:label`)).slice(0, 12)
    .map(item => ({ eventId: item.event_id, observedLabel: damagedById.get(item.event_id)?.label || "unknown" }));
  const duplicateGroups = logs.filter(item => ["exact_duplicate", "near_duplicate"].includes(item.problem))
    .sort((a, b) => hash(`${room}:${a.event_id}:duplicate`) - hash(`${room}:${b.event_id}:duplicate`)).slice(0, 12)
    .map(item => ({ duplicateId: item.event_id, sourceId: item.original_value, kind: item.problem }));
  return {
    missingColumns: countBy("missing_value"),
    outlierColumns: countBy("outlier"),
    labelCandidates,
    duplicateGroups,
    costs: COSTS,
    limits: LIMITS,
    budget: BUDGET
  };
}

function repairOptions(plan) {
  const topMissing = plan.missingColumns.slice(0, LIMITS.missing).reduce((sum, item) => sum + item.issueCount, 0) || 1;
  const topOutliers = plan.outlierColumns.slice(0, LIMITS.outlier).reduce((sum, item) => sum + item.issueCount, 0) || 1;
  return [
    ...plan.missingColumns.map(item => ({ kind: "missing", id: item.feature, cost: COSTS.missing, gain: 35 * item.issueCount / topMissing })),
    ...plan.outlierColumns.map(item => ({ kind: "outlier", id: item.feature, cost: COSTS.outlier, gain: 25 * item.issueCount / topOutliers })),
    ...plan.labelCandidates.map(item => ({ kind: "label", id: item.eventId, cost: COSTS.label, gain: 20 / LIMITS.label })),
    ...plan.duplicateGroups.map(item => ({ kind: "duplicate", id: item.duplicateId, cost: COSTS.duplicate, gain: 20 / LIMITS.duplicate }))
  ];
}

function maxGain(options) {
  let states = new Map([["0:0:0:0:0", 0]]);
  for (const option of options) {
    const next = new Map(states);
    for (const [key, gain] of states) {
      const [cost, missing, outlier, label, duplicate] = key.split(":").map(Number);
      const counts = { missing, outlier, label, duplicate };
      if (cost + option.cost > BUDGET || counts[option.kind] >= LIMITS[option.kind]) continue;
      counts[option.kind]++;
      const nextKey = `${cost + option.cost}:${counts.missing}:${counts.outlier}:${counts.label}:${counts.duplicate}`;
      next.set(nextKey, Math.max(next.get(nextKey) || 0, gain + option.gain));
    }
    states = next;
  }
  return Math.max(...states.values());
}

export function scoreRepairPlan(plan, repairs) {
  const selected = new Map([
    ...repairs.missingColumns.map(id => [`missing:${id}`, true]),
    ...repairs.outlierColumns.map(id => [`outlier:${id}`, true]),
    ...repairs.labelRecords.map(id => [`label:${id}`, true]),
    ...repairs.duplicateGroups.map(id => [`duplicate:${id}`, true])
  ]);
  const options = repairOptions(plan), gain = options.filter(option => selected.has(`${option.kind}:${option.id}`)).reduce((sum, option) => sum + option.gain, 0);
  return Number((gain / (maxGain(options) || 1) * 100).toFixed(1));
}

function validateRepairs(plan, body) {
  const repairs = {
    missingColumns: unique(body?.missingColumns),
    outlierColumns: unique(body?.outlierColumns),
    labelRecords: unique(body?.labelRecords),
    duplicateGroups: unique(body?.duplicateGroups)
  };
  const allowed = {
    missingColumns: new Set(plan.missingColumns.map(item => item.feature)),
    outlierColumns: new Set(plan.outlierColumns.map(item => item.feature)),
    labelRecords: new Set(plan.labelCandidates.map(item => item.eventId)),
    duplicateGroups: new Set(plan.duplicateGroups.map(item => item.duplicateId))
  };
  for (const [key, values] of Object.entries(repairs)) {
    const limit = { missingColumns: LIMITS.missing, outlierColumns: LIMITS.outlier, labelRecords: LIMITS.label, duplicateGroups: LIMITS.duplicate }[key];
    if (values.length > limit || values.some(value => !allowed[key].has(value))) throw new Error(`Invalid ${key} repair selection.`);
  }
  const spend = repairs.missingColumns.length * COSTS.missing + repairs.outlierColumns.length * COSTS.outlier + repairs.labelRecords.length * COSTS.label + repairs.duplicateGroups.length * COSTS.duplicate;
  if (spend > BUDGET) throw new Error(`Repair plan costs ${spend}; Event 4 allows ${BUDGET}.`);
  return { repairs, spend };
}

export default function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST required" });
  const room = clean(req.body?.room, 16), player = clean(req.body?.player, 20), action = clean(req.body?.action, 16);
  if (!room || !player) return json(res, 400, { error: "Room and player are required." });
  try {
    const featureState = verifyState(req.body?.featureState, "features", room, player), event = assignment(room);
    const plan = buildQualityPlan(event, featureState.selected, room);
    if (action === "plan") return json(res, 200, { plan, lockedFeatures: featureState.selected, emergencyFeatures: event.backupFeatures });
    if (action !== "seal") return json(res, 400, { error: "Choose plan or seal." });
    const emergencyFeed = Boolean(req.body?.emergencyFeed);
    if (emergencyFeed) {
      if (featureState.strongCount > EMERGENCY_MAX_STRONG_CHANNELS) throw new Error(`Emergency Feed is available only after a failed Feature Hunt lock (${EMERGENCY_MAX_STRONG_CHANNELS} or fewer strong channels).`);
      const qualityState = packState("quality", { room, player, features: event.backupFeatures, featureScore: 0, qualityScore: EMERGENCY_QUALITY_SCORE, emergencyFeed: true, repairs: { missingColumns: [], outlierColumns: [], labelRecords: [], duplicateGroups: [] }, repairSpend: 0 });
      return json(res, 200, { sealed: true, emergencyFeed: true, features: event.backupFeatures, featureScore: 0, qualityScore: EMERGENCY_QUALITY_SCORE, repairSpend: 0, repairBudget: BUDGET, qualityState, message: "Emergency Telemetry Feed locked as a recovery route. Event 3 is forfeited, Event 4 is capped at 35/100, and the clean 6-strong + 4-weak backup pair now carries into Event 5." });
    }
    const { repairs, spend } = validateRepairs(plan, req.body?.repairs), qualityScore = scoreRepairPlan(plan, repairs);
    const qualityState = packState("quality", { room, player, features: featureState.selected, featureScore: featureState.score, qualityScore, emergencyFeed: false, repairs, repairSpend: spend });
    return json(res, 200, { sealed: true, emergencyFeed: false, features: featureState.selected, featureScore: featureState.score, qualityScore, repairSpend: spend, repairBudget: BUDGET, qualityState, message: `Data Quality Lab sealed: ${spend}/15 credits spent, repair effectiveness ${qualityScore}/100.` });
  } catch (error) {
    const message = ["STATE_REQUIRED", "INVALID_STATE"].includes(error.message) ? "The Feature Hunt seal could not be verified. Reload the mission." : error.message;
    return json(res, 409, { error: message });
  }
}
