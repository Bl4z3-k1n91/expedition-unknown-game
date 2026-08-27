import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export const DATASETS = [
  { id: "uci-wine-quality-red", title: "UCI Wine Quality: Red", file: "winequality-red.csv", variant: "red wine" },
  { id: "uci-wine-quality-white", title: "UCI Wine Quality: White", file: "winequality-white.csv", variant: "white wine" }
];
export const SOURCE_URL = "https://archive.ics.uci.edu/dataset/186/wine+quality";
export const hash = value => { let n = 2166136261; for (const c of value) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; };
export function loadRows(dataset) {
  const [header, ...lines] = readFileSync(new URL(`../data/${dataset.file}`, import.meta.url), "utf8").trim().split(/\r?\n/);
  const columns = header.split(";").map(x => x.replaceAll('"', '').replaceAll(' ', '_'));
  return lines.map((line, index) => { const values = line.split(";").map(Number), row = { id: `${dataset.id}-${String(index + 1).padStart(4, "0")}` }; columns.forEach((column, i) => { if (column !== "quality") row[column] = values[i]; }); row.target = `quality_${values[columns.indexOf("quality")]}`; return row; });
}
export function assignment(room) {
  const dataset = DATASETS[hash(room) % DATASETS.length];
  const ordered = loadRows(dataset).sort((a, b) => (hash(`${room}:${a.id}`) % 100000) - (hash(`${room}:${b.id}`) % 100000));
  const working = ordered.slice(0, 200), hidden = ordered.slice(200, 300);
  const features = Object.keys(working[0]).filter(x => !["id", "target"].includes(x));
  return { dataset, features, known: working.slice(0, 150), unknown: working.slice(150), hidden };
}
export function qualityLab(event) {
  const rows = [...event.known, ...event.unknown].map(row => ({ ...row }));
  // The source rows stay server-held; these are the deliberate round-two faults.
  [4, 21, 74].forEach(index => rows[index].residual_sugar = null);
  [12, 49].forEach(index => rows[index].chlorides *= 10);
  rows[61] = { ...rows[60], id: rows[61].id };
  rows[119] = { ...rows[118], id: rows[119].id };
  return rows;
}
export function recoveryPlan(event) {
  const [first, ...rest] = event.features, left = [first, ...rest.slice(0, 5)], right = ["id", ...rest.slice(5)];
  const checksum = recoveryChecksum(event);
  const files = [
    { id: "packet_a", name: "telemetry.csv", rows: [1, 120], columns: ["id", ...left, "packet_crc"], origin: "Transmission A", role: "Sensor block: acidity through chlorides", description: "The first half of a split sensor export. It covers EX-001–EX-120, but it deliberately stops before the remaining measurements.", preview: "EX-001 → EX-120 · partial measurement block" },
    { id: "packet_b", name: "telemetry.csv", rows: [1, 118], columns: [...right, "source_file"], origin: "Transmission B", role: "Companion sensor block: sulphur through alcohol", description: "The matching companion export for EX-001–EX-118. Combine its fields with Transmission A to complete those records.", preview: "EX-001 → EX-118 · complementary measurement block" },
    { id: "packet_c", name: "telemetry.csv", rows: [81, 200], columns: ["id", ...event.features], origin: "Transmission C", role: "Complete telemetry continuation", description: "A complete 11-measurement snapshot for the final stretch of the expedition: EX-081–EX-200.", preview: "EX-081 → EX-200 · full measurement block" },
    { id: "packet_d", name: "telemetry.csv", rows: [1, 200], columns: ["id", ...event.features], origin: "Transmission D", role: "Unverified full-file duplicate", description: "A tempting all-in-one copy. Its filename and coverage look right, but its received fingerprint is not on Mission Control's manifest.", preview: "EX-001 → EX-200 · full-file duplicate" },
    { id: "ledger_primary", name: "labels.csv", rows: [1, 150], columns: ["id", "label", "reviewer_note"], origin: "Transmission E", role: "Trusted labels ledger", description: "The approved labels ledger for the first 150 records. reviewer_note is transit paperwork, not analysis data.", preview: "EX-001 → EX-150 · labels block" },
    { id: "ledger_backup", name: "labels.csv", rows: [1, 150], columns: ["id", "label"], origin: "Transmission F", role: "Unverified labels duplicate", description: "A clean-looking duplicate ledger. It has the same coverage as the trusted ledger but does not match the approved fingerprint.", preview: "EX-001 → EX-150 · labels duplicate" }
  ];
  const fingerprinted = files.map(file => ({ ...file, sha256: transmissionChecksum(event, file) }));
  const approved = fingerprinted.filter(file => ["packet_a", "packet_b", "packet_c", "ledger_primary"].includes(file.id));
  return {
    checksum,
    instruction: `<strong>Mission objective:</strong> reconstruct the Expedition’s 200-record analysis package: 11 measurement fields for every record and trusted labels for EX-001–EX-150.<br><br><strong>Read this first — fingerprints select the files:</strong> a SHA-256 is an unforgeable file fingerprint. Mission Control sent the approved transmission manifest below. Only use archive cards whose <em>received SHA-256</em> appears in that manifest. The archive intentionally contains same-named lookalikes with unapproved fingerprints.<br><br><strong>Then assemble the data:</strong> choose the row ranges and analysis columns you need from the approved cards. Overlap is allowed when records agree. Do not include transit paperwork: packet_crc, source_file, or reviewer_note. Finally, the server checks the fingerprint of the complete reconstructed package: <strong>SHA-256 ${checksum}</strong>.`,
    manifest: approved.map(file => ({ name: file.name, origin: file.origin, role: file.role, sha256: file.sha256 })),
    approvedFingerprints: approved.map(file => file.sha256),
    files: fingerprinted
  };
}
export function transmissionChecksum(event, file) {
  const values = [];
  for (let row = file.rows[0]; row <= file.rows[1]; row++) {
    const source = row <= 150 ? event.known[row - 1] : event.unknown[row - 151];
    values.push([`EX-${String(row).padStart(3, "0")}`, ...file.columns.map(column => {
      if (column === "id") return `EX-${String(row).padStart(3, "0")}`;
      if (column === "packet_crc") return `CRC-${String(row).padStart(3, "0")}`;
      if (column === "source_file") return file.name;
      if (column === "reviewer_note") return `reviewed-${String(row).padStart(3, "0")}`;
      const original = column === "label" ? source.target : source[column];
      return (file.id === "packet_d" && column === "chlorides") ? Number(original) + 0.004 : (file.id === "ledger_backup" && column === "label") ? (original === "quality_5" ? "quality_6" : "quality_5") : original;
    })]);
  }
  return createHash("sha256").update(JSON.stringify({ name: file.name, rows: file.rows, columns: file.columns, values })).digest("hex");
}
export function recoveryChecksum(event, cells) {
  const rows = [...event.known, ...event.unknown].map((source, index) => [
    `EX-${String(index + 1).padStart(3, "0")}`,
    ...event.features.map(feature => cells?.[index]?.[feature] ?? source[feature]),
    cells?.[index]?.label ?? (index < 150 ? source.target : "")
  ]);
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
export const withoutTarget = row => { const { target, ...clean } = row; return clean; };
