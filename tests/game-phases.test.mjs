import test from "node:test";
import assert from "node:assert/strict";
import { assignment, WILDLIFE_CLASSES } from "../api/_event.js";
import labelsHandler from "../api/labels.js";
import cameraHandler from "../api/camera.js";

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
