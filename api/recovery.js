import { clean, json } from "./_gateway.js";
import { assignment, recoveryChecksum, recoveryPlan } from "./_event.js";

const corruptedValue = (fileId, column, value) => {
  if (fileId === "packet_d" && column === "chlorides") return Number(value) + 0.004;
  if (fileId === "ledger_backup" && column === "label") return value === "quality_5" ? "quality_6" : "quality_5";
  return value;
};
const hintFor = error => {
  if (error.includes("not in Mission Control's approved manifest")) return "Compare the card's received SHA-256 with the approved transmission manifest. Same filename does not mean the same file.";
  if (error.includes("not part of the analysis dataset")) return "Keep measurement fields, record ID, and the trusted label only. Metadata does not belong in the checksum.";
  if (error.includes("Missing trusted label")) return "The first 150 records need a labels.csv selection containing both record ID and label.";
  if (error.includes("Missing")) return "One or more row ranges are missing a measurement field. Look for an overlapping telemetry.csv transmission that supplies it.";
  if (error.includes("Conflicting")) return "Two selected transmissions disagree on the same cell. Remove one overlapping source and try the other copy.";
  if (error.includes("Labels are only valid")) return "Labels end at EX-150. The final 50 records must remain unlabeled.";
  return "Check that each selected range stays within its transmission and that every selected column belongs to that file.";
};
export default function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST required" });
  const room = clean(req.body?.room, 16), action = clean(req.body?.action, 16), selections = Array.isArray(req.body?.selections) ? req.body.selections : [];
  if (!room) return json(res, 400, { error: "Room is required" });
  const event = assignment(room), plan = recoveryPlan(event), files = new Map(plan.files.map(file => [file.id, file])), cells = Array.from({ length: 200 }, () => ({}));
  if (action === "classify") {
    const decisions = Array.isArray(req.body?.decisions) ? req.body.decisions : [];
    const stated = new Map(decisions.map(item => [item?.fileId, item?.verdict]));
    const incorrect = plan.files.find(file => {
      const shouldTrust = plan.approvedFingerprints.includes(file.sha256);
      return stated.get(file.id) !== (shouldTrust ? "trusted" : "quarantine");
    });
    if (incorrect) return json(res, 422, { valid: false, error: `${incorrect.origin} was classified incorrectly.`, hint: "Read its received SHA-256 character-for-character against Mission Control's approved manifest. A matching filename is not evidence." });
    return json(res, 200, { valid: true, message: "Chain of custody sealed. Four transmissions are trusted; two lookalikes are quarantined." });
  }
  const errors = [];
  for (const selected of selections) {
    const file = files.get(selected?.fileId), start = Number(selected?.rowStart), end = Number(selected?.rowEnd), columns = Array.isArray(selected?.columns) ? [...new Set(selected.columns)] : [];
    if (!file || !Number.isInteger(start) || !Number.isInteger(end) || start < file.rows[0] || end > file.rows[1] || start > end || !columns.length || columns.some(column => !file.columns.includes(column))) { errors.push("One selected fragment has invalid rows or columns."); continue; }
    if (!plan.approvedFingerprints.includes(file.sha256)) { errors.push(`${file.origin}'s received SHA-256 is not in Mission Control's approved manifest.`); continue; }
    for (let row = start; row <= end; row++) for (const column of columns) {
      if (column === "id") continue;
      if (![...event.features, "label"].includes(column)) { errors.push(`Remove ${column}: it is not part of the analysis dataset.`); continue; }
      if (column === "label" && row > 150) { errors.push("Labels are only valid for EX-001 through EX-150."); continue; }
      const source = row <= 150 ? event.known[row - 1] : event.unknown[row - 151];
      const original = column === "label" ? source.target : source[column], value = corruptedValue(file.id, column, original), previous = cells[row - 1][column];
      if (previous !== undefined && previous !== value) errors.push(`Conflicting ${column} values for EX-${String(row).padStart(3, "0")}.`);
      cells[row - 1][column] = value;
    }
  }
  for (let row = 0; row < 200; row++) {
    for (const feature of event.features) if (cells[row][feature] === undefined) errors.push(`Missing ${feature} for EX-${String(row + 1).padStart(3, "0")}.`);
    if (row < 150 && cells[row].label === undefined) errors.push(`Missing trusted label for EX-${String(row + 1).padStart(3, "0")}.`);
  }
  const expectedChecksum = plan.checksum, actualChecksum = errors.length ? null : recoveryChecksum(event, cells);
  if (errors.length) return json(res, 422, { valid: false, expectedChecksum, error: errors[0], hint: hintFor(errors[0]), detail: "The reconstructed package is incomplete or contains non-data fields." });
  if (actualChecksum !== expectedChecksum) return json(res, 422, { valid: false, expectedChecksum, actualChecksum, error: "Checksum mismatch. The row and column shape is complete, but at least one selected transmission is not the original data.", hint: "The shape is right. Replace one overlapping telemetry.csv or labels.csv transmission; one copy contains altered values." });
  return json(res, 200, { valid: true, expectedChecksum, actualChecksum, message: "Checksum verified. Original 200-record package restored: 11 measurements, 150 trusted labels, 50 unresolved labels." });
}
