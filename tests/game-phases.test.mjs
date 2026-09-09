import test from "node:test";
import assert from "node:assert/strict";
import { assignment, manualClass, MANUAL_CLASSES } from "../api/_event.js";
import missionHandler from "../api/mission.js";
import labelsHandler from "../api/labels.js";
import analyzeHandler from "../api/analyze.js";
import featuresHandler from "../api/features.js";
import qualityHandler, { buildQualityPlan, scoreRepairPlan } from "../api/quality.js";
import cameraHandler from "../api/camera.js";
import { readFileSync } from "node:fs";

const response = () => ({ statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end(body) { this.body = body; } });
const invoke = async (handler, body, query) => { const res = response(); await handler({ method: "POST", body, query }, res); return res; };

async function sealedFlow(room = "731904", player = "grid-cell") {
  const event = assignment(room), labels = Object.fromEntries(event.manualRows.map(row => [row.manual_id, manualClass(row)]));
  const manual = await invoke(labelsHandler, { room, player, labels });
  const selected = event.features.slice(0, 10), features = await invoke(featuresHandler, { room, player, features: selected });
  const planResponse = await invoke(qualityHandler, { room, player, action: "plan", featureState: features.body.featureState });
  const plan = planResponse.body.plan, repairs = { missingColumns: plan.missingColumns.slice(0, 3).map(item => item.feature), outlierColumns: plan.outlierColumns.slice(0, 2).map(item => item.feature), labelRecords: [], duplicateGroups: [] };
  const quality = await invoke(qualityHandler, { room, player, action: "seal", featureState: features.body.featureState, repairs });
  return { event, manual: manual.body, features: features.body, plan, quality: quality.body };
}

test("the supplied package loads the exact event-scale train/test tiers", async () => {
  const event = assignment("100001"), mission = await invoke(missionHandler, { room: "100001", player: "auditor" });
  assert.equal(event.trainDamaged.length, 2030);
  assert.equal(event.trainClean.length, 2000);
  assert.equal(event.test.length, 500);
  assert.equal(event.features.length, 16);
  assert.equal(event.backupFeatures.length, 10);
  assert.equal(event.manualRows.length, 50);
  assert.deepEqual(Object.keys(event.test[0]).filter(key => key !== "event_id"), event.features);
  assert.deepEqual(Object.keys(event.testBackup[0]).filter(key => key !== "event_id"), event.backupFeatures);
  assert.deepEqual(Object.keys(event.trainBackup[0]).filter(key => !["event_id", "label"].includes(key)), event.backupFeatures);
  assert.ok(event.test.every(row => !("label" in row)));
  assert.equal(mission.body.mission.scope, "Events 2–5");
  assert.deepEqual(mission.body.submissionSchema, ["event_id", "prediction"]);
});

test("Manual Override follows priority order and +1/-1/0 scoring", async () => {
  assert.equal(manualClass({ incident_distance_m: 49.9, vehicle_count: 70, avg_vehicle_speed_kmph: 2, pedestrian_count: 30 }), "Accident");
  assert.equal(manualClass({ incident_distance_m: 50, vehicle_count: 25, avg_vehicle_speed_kmph: 24.9, pedestrian_count: 30 }), "Heavy_Traffic");
  assert.equal(manualClass({ incident_distance_m: 50, vehicle_count: 24, avg_vehicle_speed_kmph: 10, pedestrian_count: 10 }), "Pedestrian_Crossing");
  assert.equal(manualClass({ incident_distance_m: 50, vehicle_count: 24, avg_vehicle_speed_kmph: 10, pedestrian_count: 9 }), "Normal_Traffic");
  const room = "200002", player = "paper-team", event = assignment(room), labels = {};
  event.manualRows.slice(0, 10).forEach(row => labels[row.manual_id] = manualClass(row));
  event.manualRows.slice(10, 15).forEach(row => labels[row.manual_id] = MANUAL_CLASSES.find(label => label !== manualClass(row)));
  const res = await invoke(labelsHandler, { room, player, labels });
  assert.equal(res.statusCode, 200); assert.equal(res.body.correct, 10); assert.equal(res.body.wrong, 5); assert.equal(res.body.blank, 35); assert.equal(res.body.points, 5); assert.ok(res.body.manualState);
});

test("Feature Hunt spends a signed 10-credit ledger and locks exactly ten channels", async () => {
  const room = "300003", player = "feature-team", event = assignment(room);
  const blocked = await invoke(analyzeHandler, { room, player, type: "importance" });
  assert.equal(blocked.statusCode, 400);
  const stats = await invoke(analyzeHandler, { room, player, type: "stats", feature: event.features[0] });
  assert.equal(stats.body.creditsRemaining, 9);
  const correlation = await invoke(analyzeHandler, { room, player, type: "correlation", analysisState: stats.body.analysisState });
  assert.equal(correlation.body.creditsRemaining, 7);
  const bad = await invoke(featuresHandler, { room, player, features: event.features.slice(0, 9), analysisState: correlation.body.analysisState });
  assert.equal(bad.statusCode, 400);
  const sealed = await invoke(featuresHandler, { room, player, features: event.features.slice(0, 10), analysisState: correlation.body.analysisState });
  assert.equal(sealed.statusCode, 200); assert.equal(sealed.body.selected.length, 10); assert.equal(sealed.body.strongCount, 10); assert.ok(sealed.body.featureState);
});

test("Data Quality Lab enforces the 15-credit typed repair plan", async () => {
  const flow = await sealedFlow(), scored = scoreRepairPlan(flow.plan, flow.quality.qualityState ? { missingColumns: flow.plan.missingColumns.slice(0, 3).map(item => item.feature), outlierColumns: flow.plan.outlierColumns.slice(0, 2).map(item => item.feature), labelRecords: [], duplicateGroups: [] } : {});
  assert.equal(flow.quality.repairSpend, 15); assert.ok(flow.quality.qualityScore > 0); assert.ok(scored > 0);
  const over = await invoke(qualityHandler, { room: "731904", player: "grid-cell", action: "seal", featureState: flow.features.featureState, repairs: { missingColumns: flow.plan.missingColumns.slice(0, 3).map(item => item.feature), outlierColumns: flow.plan.outlierColumns.slice(0, 2).map(item => item.feature), labelRecords: flow.plan.labelCandidates.slice(0, 1).map(item => item.eventId), duplicateGroups: [] } });
  assert.equal(over.statusCode, 409); assert.match(over.body.error, /costs 16.*allows 15/i);
});

test("Emergency Feed is a low-score breakout route, not an alternate winning path", async () => {
  const room = "400004", player = "rescue-team", event = assignment(room);
  const strongLock = await invoke(featuresHandler, { room, player, features: event.features.slice(0, 10) });
  const blocked = await invoke(qualityHandler, { room, player, action: "seal", featureState: strongLock.body.featureState, emergencyFeed: true, repairs: {} });
  assert.equal(blocked.statusCode, 409); assert.match(blocked.body.error, /4 or fewer strong/i);
  const poorLock = await invoke(featuresHandler, { room, player: "poor-lock", features: [...event.features.slice(0, 4), ...event.features.slice(-6)] });
  const result = await invoke(qualityHandler, { room, player: "poor-lock", action: "seal", featureState: poorLock.body.featureState, emergencyFeed: true, repairs: {} });
  assert.equal(result.statusCode, 200); assert.equal(poorLock.body.strongCount, 4); assert.equal(result.body.featureScore, 0); assert.equal(result.body.qualityScore, 35); assert.deepEqual(result.body.features, event.backupFeatures);
});

test("Event 5 is implemented as a native Vercel scikit-learn pipeline", () => {
  const source = readFileSync(new URL("../api/ml_pipeline.py", import.meta.url), "utf8"), entry = readFileSync(new URL("../api/run.py", import.meta.url), "utf8");
  assert.match(source, /Pipeline\(\[/); assert.match(source, /SimpleImputer/); assert.match(source, /StandardScaler/); assert.match(source, /StratifiedKFold/); assert.match(source, /RandomForestClassifier/); assert.match(entry, /BaseHTTPRequestHandler/);
});

test("the retired camera route states that Event 2 is tabular", () => {
  const res = response(); cameraHandler({}, res); assert.equal(res.statusCode, 410); assert.match(res.body, /tabular junction readings/);
});
