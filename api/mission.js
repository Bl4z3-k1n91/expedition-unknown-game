import { clean, json } from "./_gateway.js";
import { assignment, qualityLab, recoveryPlan, SOURCE_URL, withoutTarget } from "./_event.js";

export default function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST required" });
  const room = clean(req.body?.room, 16), player = clean(req.body?.player, 20);
  if (!room || !player) return json(res, 400, { error: "room and player are required" });
  const event = assignment(room), recovery = recoveryPlan(event), labRows = qualityLab(event), known = labRows.slice(0, 150), unknown = labRows.slice(150), classes = [...new Set(event.known.map(x => x.target))].sort();
  return json(res, 200, {
    mission: { id: event.dataset.id, title: event.dataset.title, variant: event.dataset.variant, sourceUrl: SOURCE_URL, license: "CC BY 4.0", featureLimit: 8, featureCredits: 10, repairCredits: 15, evaluationLimit: 8, metric: "Macro F1" },
    recovery: { instruction: recovery.instruction, manifest: recovery.manifest, files: recovery.files },
    features: event.features,
    knownRows: known,
    unknownRows: unknown.map(withoutTarget),
    allowedLabels: classes,
    finalTestRows: event.hidden.map(withoutTarget),
    recordCounts: { working: 200, known: 150, unknown: 50, finalTest: 100 },
    submissionSchema: ["id", "prediction"]
  });
}
