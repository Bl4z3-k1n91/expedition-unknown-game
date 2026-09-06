import test from "node:test";
import assert from "node:assert/strict";
import { assignment, WILDLIFE_CLASSES } from "../api/_event.js";
import labelsHandler from "../api/labels.js";
import cameraHandler from "../api/camera.js";
import analyzeHandler from "../api/analyze.js";

const response = () => ({ statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(body) { this.body = body; } });

test("both server-selected datasets expose all four image classes", () => {
  for (const room of ["100001", "100002", "100003", "100004"]) {
    const classes = new Set(assignment(room).unknown.map(row => row.target));
    WILDLIFE_CLASSES.forEach(label => assert.ok(classes.has(label), `${room} missing ${label}`));
  }
});

test("camera endpoint returns a labelled-record-safe SVG frame", () => {
  const res = response(); cameraHandler({ query: { room: "100002", record: "EX-151" } }, res);
  assert.equal(res.statusCode, 200); assert.match(res.headers["Content-Type"], /image\/svg/); assert.match(res.body, /EXP-CAM \/\/ EX-151/);
  WILDLIFE_CLASSES.forEach(label => assert.doesNotMatch(res.body, new RegExp(`aria-label="${label}`)));
});

test("label lock scores all 50 server-side", () => {
  const event = assignment("100002"), labels = Object.fromEntries(event.unknown.map(row => [row.id, row.target])), res = response();
  res.status = code => { res.statusCode = code; return res; }; res.json = body => { res.body = body; };
  labelsHandler({ method: "POST", body: { room: "100002", labels } }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.correct, 50); assert.equal(res.body.score, 100);
});

test("feature investigations reveal evidence and enforce the 10-credit ledger", () => {
  const room = "100002", event = assignment(room), labels = Object.fromEntries(event.unknown.map(row => [row.id, row.target]));
  const invoke = body => { const res = response(); res.status = code => { res.statusCode = code; return res; }; res.json = value => { res.body = value; }; analyzeHandler({ method: "POST", body: { room, player: "analyst", labels, ...body } }, res); return res; };
  const stats = invoke({ type: "stats", feature: "alcohol" });
  assert.equal(stats.statusCode, 200); assert.equal(stats.body.cost, 1); assert.equal(stats.body.creditsRemaining, 9); assert.equal(typeof stats.body.result.summary.variance, "number");
  const missing = invoke({ type: "missing", feature: "residual_sugar", analysisState: stats.body.analysisState });
  assert.equal(missing.body.result.missingCount, 3); assert.equal(missing.body.creditsRemaining, 8);
  const matrix = invoke({ type: "correlation", analysisState: missing.body.analysisState });
  assert.equal(matrix.body.result.matrix.length, event.features.length); assert.equal(matrix.body.creditsRemaining, 6);
  const importance = invoke({ type: "importance", analysisState: matrix.body.analysisState });
  assert.equal(importance.body.result.ranking.length, event.features.length); assert.equal(importance.body.creditsRemaining, 3);
  const overBudget = invoke({ type: "importance", analysisState: importance.body.analysisState, feature: "fixed_acidity" });
  assert.equal(overBudget.statusCode, 200); assert.equal(overBudget.body.cost, 0);
  const blocked = invoke({ type: "relationship", feature: "alcohol", secondFeature: "density", analysisState: importance.body.analysisState });
  assert.equal(blocked.statusCode, 200); assert.equal(blocked.body.creditsRemaining, 1);
  const finalBlocked = invoke({ type: "classwise", feature: "alcohol", analysisState: blocked.body.analysisState });
  assert.equal(finalBlocked.statusCode, 409); assert.match(finalBlocked.body.error, /only 1 remain/);
});
