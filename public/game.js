import { buildKaggleScript, kaggleFilename, normalizeTuning } from "/kaggle-export.js";

const session = JSON.parse(sessionStorage.getItem("expedition-session") || "null");
if (!session) window.location.replace("/");

const box = document.querySelector("#workspace"), download = document.querySelector("#export"), statusText = document.querySelector("#mission-status");
const featureCredit = document.querySelector("#f-credit"), repairCredit = document.querySelector("#r-credit"), evaluationCredit = document.querySelector("#e-credit");
const stageOrder = ["manual", "features", "quality", "forecast"];
const analysisCatalog = [
  ["stats", "Basic channel statistics", 1, "Mean, median, deviation, range and missing percentage."],
  ["missing", "Missing-value analysis", 1, "Null count and affected training records."],
  ["classwise", "Class-wise distribution", 2, "Compare one channel across all five traffic classes."],
  ["correlation", "Correlation analysis", 2, "Inspect redundancy across all sixteen channels."],
  ["relationship", "Channel relationship view", 2, "Compare two channels across five value bands."]
];
const models = [
  ["Decision Tree", "Tune depth, split, leaf, criterion, and class weighting."],
  ["Logistic Regression", "Tune regularization, solver, and class weighting."],
  ["K-Nearest Neighbors", "Tune neighborhood size, distance rule, and metric."],
  ["Random Forest", "Tune tree count, depth, split, features, and weighting."],
  ["Support Vector Machine", "Tune C, RBF gamma, and class weighting."]
];
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const request = async (path, body) => { const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), result = await response.json(); if (!response.ok) throw Object.assign(new Error(result.error), { result }); return result; };

let data, stage = "manual", highestStage = 0;
let manualLabels = {}, manualLocked = false, manualState = "", manualResult = null, manualStatus = "";
let selectedFeatures = new Set(), analysisType = "stats", analysisFeature = "", analysisSecond = "", analysisState = "", analysisCredits = 10, findings = [], featureState = "", featureResult = null, featureStatus = "";
let qualityPlan = null, repairs = { missingColumns: new Set(), outlierColumns: new Set(), labelRecords: new Set(), duplicateGroups: new Set() }, emergencyFeed = false, qualityState = "", qualityResult = null, qualityStatus = "";
let model = "Decision Tree", tuning = normalizeTuning(), kaggleScript = "", forecastStatus = "";

const featureName = name => data?.featureMeta?.[name]?.label || String(name).replaceAll("_", " ");
const number = value => Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
const sectionIntro = (event, title, subtitle, beats) => `<section class="story-brief"><span>EVENT ${event} · ${esc(title.toUpperCase())}</span><h1>${esc(title.split(" ")[0])} <i>${esc(title.split(" ").slice(1).join(" "))}</i></h1><p>${esc(subtitle)}</p><div class="story-beats">${beats.map((beat, index) => `<span class="${index < stageOrder.indexOf(stage) ? "done" : index === stageOrder.indexOf(stage) ? "active" : ""}">${esc(beat)}</span>`).join("")}</div></section>`;

function setStage(next) {
  const index = stageOrder.indexOf(next); if (index < 0 || index > highestStage) return;
  stage = next; render(); window.scrollTo({ top: 0, behavior: "smooth" });
}
function updateChrome() {
  featureCredit.textContent = `${analysisCredits} / 10`;
  const spent = repairSpend(); repairCredit.textContent = `${Math.max(0, 15 - spent)} / 15`;
  evaluationCredit.textContent = `${tuning.trials} trials`;
  document.querySelectorAll("[data-stage]").forEach(button => { const index = stageOrder.indexOf(button.dataset.stage); button.classList.toggle("active", button.dataset.stage === stage); button.classList.toggle("is-active", button.dataset.stage === stage); button.disabled = index > highestStage; });
}

function renderManual() {
  const answered = Object.values(manualLabels).filter(Boolean).length;
  return `${sectionIntro("2", "Manual Override", "Fifty queued junction readings cannot wait for CLEARWAY to reboot. Apply the printed checklist from top to bottom; the first matching rule wins. Wrong calls cost a point, while blanks score zero.", ["Manual Override", "Feature Hunt", "Quality Lab", "Forecast"])}
    <section class="incident-ribbon"><div><small>QUEUED READINGS</small><b>50 tabular records</b></div><div><small>SCORING</small><b>+1 correct · −1 wrong · 0 blank</b></div><div><small>PROTOCOL</small><b>First matching rule wins</b></div><div><small>PROGRESS</small><b>${answered}/50 answered</b></div></section>
    <section class="card"><div class="panel-title">Paper protocol <span>Read every rule in order</span></div><div class="protocol-grid">${data.manualRules.map(rule => `<article><span>RULE ${rule.priority}</span><b>${esc(rule.label)}</b><small>${esc(rule.test)}</small></article>`).join("")}</div></section>
    <section class="card"><div class="panel-title">Manual review tray <span>Road occupancy is context; it is not a decision threshold in this protocol</span></div><div class="table-scroll"><table class="data-table manual-table"><thead><tr><th>ID</th><th>Vehicles</th><th>Avg speed</th><th>Occupancy</th><th>Pedestrians</th><th>Incident distance</th><th>Controller call</th></tr></thead><tbody>${data.manualRows.map(row => `<tr><th>${row.manual_id}</th><td>${row.vehicle_count}</td><td>${row.avg_vehicle_speed_kmph} km/h</td><td>${row.road_occupancy_pct}%</td><td>${row.pedestrian_count}</td><td>${row.incident_distance_m} m</td><td><select data-manual="${row.manual_id}" ${manualLocked ? "disabled" : ""}><option value="">Leave blank · 0 points</option>${data.manualClasses.map(label => `<option value="${label}" ${manualLabels[row.manual_id] === label ? "selected" : ""}>${label}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div><div class="stage-actions"><span class="${manualResult ? "recovery-message success" : "recovery-message"}">${esc(manualStatus || "You may seal the ledger with blanks; guessing carries a real penalty.")}</span>${manualLocked ? `<button class="btn btn--primary" data-next="features">Open Event 3</button>` : `<button id="lock-manual" class="btn btn--primary">Seal Event 2 ledger</button>`}</div></section>`;
}

function findingHtml(item) {
  const result = item.result;
  if (result.kind === "stats") return `<article class="finding"><header><b>${esc(featureName(result.feature))}</b><span>basic statistics</span></header><div class="metric-grid">${["mean", "median", "stdDev", "min", "max"].map(key => `<div><small>${key}</small><strong>${number(result.summary[key])}</strong></div>`).join("")}</div></article>`;
  if (result.kind === "missing") return `<article class="finding"><header><b>${esc(featureName(result.feature))}</b><span>missing values</span></header><div class="finding-callout"><strong>${result.missingCount}</strong><span>missing cells · ${result.missingPct}% of ${result.recordCount || 2030} delivered rows</span></div></article>`;
  if (result.kind === "classwise") return `<article class="finding"><header><b>${esc(featureName(result.feature))}</b><span>class-wise distribution</span></header><table class="analysis-table"><thead><tr><th>Class</th><th>Mean</th><th>Std dev</th><th>Missing</th></tr></thead><tbody>${result.classes.map(row => `<tr><th>${esc(row.label)}</th><td>${number(row.mean)}</td><td>${number(row.stdDev)}</td><td>${row.missingCount}</td></tr>`).join("")}</tbody></table></article>`;
  if (result.kind === "correlation") return `<article class="finding"><header><b>All 16 channels</b><span>correlation matrix</span></header><div class="matrix-scroll"><table class="matrix-table"><thead><tr><th></th>${result.features.map(name => `<th>${esc(featureName(name))}</th>`).join("")}</tr></thead><tbody>${result.features.map((name, i) => `<tr><th>${esc(featureName(name))}</th>${result.matrix[i].map(value => `<td>${number(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></article>`;
  return `<article class="finding"><header><b>${esc(featureName(result.feature))} × ${esc(featureName(result.secondFeature))}</b><span>relationship</span></header><div class="relationship-score">Pearson correlation <strong>${number(result.coefficient)}</strong></div><div class="bin-chart">${result.bins.map(bin => `<div><span>${number(bin.from)}–${number(bin.to)}</span><i><em style="width:${Math.min(100, Math.abs(bin.mean || 0))}%"></em></i><b>${number(bin.mean)}</b></div>`).join("")}</div></article>`;
}

function renderFeatures() {
  const config = analysisCatalog.find(item => item[0] === analysisType), global = analysisType === "correlation", pair = analysisType === "relationship";
  return `${sectionIntro("3", "Feature Hunt", "Sixteen telemetry channels survived the Surge, but Central has only ten seats. Spend investigation credits, then lock exactly ten channels. That choice cannot be reopened.", ["Manual Override", "Feature Hunt", "Quality Lab", "Forecast"])}
    <section class="incident-ribbon"><div><small>CANDIDATE CHANNELS</small><b>16</b></div><div><small>LOCKED INPUTS</small><b>Exactly 10</b></div><div><small>INVESTIGATION POOL</small><b>${analysisCredits}/10 credits</b></div><div><small>TRAIN ARCHIVE</small><b>2,030 damaged rows</b></div></section>
    <div class="investigation-shell"><aside class="tool-catalog"><div class="panel-title">Investigation menu <span>10-credit pool</span></div>${analysisCatalog.map(item => `<button data-analysis-type="${item[0]}" class="${analysisType === item[0] ? "active" : ""}" ${featureResult ? "disabled" : ""}><span><b>${esc(item[1])}</b><small>${esc(item[3])}</small></span><strong>${item[2]} CR</strong></button>`).join("")}</aside>
      <section class="evidence-console"><div class="panel-title">Analysis console <span>${esc(config[1])}</span></div><div class="analysis-config"><div><span>SELECTED TOOL</span><b>${esc(config[1])}</b><p>${esc(config[3])}</p></div>${global ? "" : `<label>Primary channel<select id="analysis-feature">${data.features.map(name => `<option value="${name}" ${analysisFeature === name ? "selected" : ""}>${esc(featureName(name))}</option>`).join("")}</select></label>`}${pair ? `<label>Comparison channel<select id="analysis-second">${data.features.filter(name => name !== analysisFeature).map(name => `<option value="${name}" ${analysisSecond === name ? "selected" : ""}>${esc(featureName(name))}</option>`).join("")}</select></label>` : ""}<button id="run-analysis" class="btn btn--primary" ${featureResult || analysisCredits < config[2] ? "disabled" : ""}>Run · ${config[2]} credits</button></div><div class="analysis-status">${esc(featureStatus || "Purchased evidence can be reopened without spending again.")}</div><div class="findings">${findings.length ? findings.map(findingHtml).join("") : `<div class="empty-finding"><b>NO INVESTIGATION PURCHASED</b><span>Choose a tool and spend credits to reveal evidence.</span></div>`}</div></section></div>
    <section class="selection-board"><div class="panel-title">Ten-channel lock <span>${selectedFeatures.size}/10 selected</span></div><div class="pick-grid">${data.features.map(name => `<button class="pick feature ${selectedFeatures.has(name) ? "chosen" : ""}" data-feature="${name}" ${featureResult ? "disabled" : ""}><b>${selectedFeatures.has(name) ? "✓" : "+"}</b><span>${esc(featureName(name))}<small>${esc(data.featureMeta[name].family)} channel</small></span></button>`).join("")}</div>${featureResult ? `<div class="feature-score"><strong>${featureResult.score}</strong><span>EVENT 3 SCORE</span><div><small>High-value seats</small><b>${featureResult.strongCount}/10</b></div><div><small>Credits spent</small><b>${featureResult.spent}/10</b></div></div><div class="stage-actions"><span class="recovery-message success">${esc(featureResult.message)}</span><button class="btn btn--primary" data-next="quality">Open Event 4</button></div>` : `<div class="feature-lock"><span>${esc(featureStatus || "Investigate first, then commit exactly ten channels.")}</span><b>${selectedFeatures.size}/10</b><button id="lock-features" class="btn btn--primary" ${selectedFeatures.size !== 10 ? "disabled" : ""}>Lock ten channels</button></div>`}</section>`;
}

const repairSpend = () => qualityPlan ? repairs.missingColumns.size * qualityPlan.costs.missing + repairs.outlierColumns.size * qualityPlan.costs.outlier + repairs.labelRecords.size * qualityPlan.costs.label + repairs.duplicateGroups.size * qualityPlan.costs.duplicate : 0;
function repairCards(kind, items) {
  const key = { missing: "missingColumns", outlier: "outlierColumns", label: "labelRecords", duplicate: "duplicateGroups" }[kind], set = repairs[key], cost = qualityPlan.costs[kind];
  return items.map(item => { const id = item.feature || item.eventId || item.duplicateId, selected = set.has(id), detail = item.issueCount ? `${item.issueCount} logged faults` : item.observedLabel ? `Observed: ${item.observedLabel}` : `${item.kind.replaceAll("_", " ")} of ${item.sourceId}`; return `<button class="repair-case ${selected ? "selected" : ""}" data-repair-kind="${kind}" data-repair-id="${id}" ${qualityResult || emergencyFeed ? "disabled" : ""}><div class="repair-case-head"><div><span class="eyebrow">${kind.toUpperCase()}</span><h3>${esc(item.feature ? featureName(item.feature) : id)}</h3></div><span class="repair-cost">${cost} CR</span></div><div class="repair-evidence"><div><small>EVIDENCE</small><p>${esc(detail)}</p></div></div></button>`; }).join("");
}
function renderQuality() {
  if (!qualityPlan) return `${sectionIntro("4", "Data Quality Lab", "The feature lock is closed. Loading only the damaged records that affect your ten selected channels.", ["Manual Override", "Feature Hunt", "Quality Lab", "Forecast"])}<section class="card"><div class="loading"><i></i>SCANNING TRAINING ARCHIVE…</div></section>`;
  const spent = repairSpend();
  const emergencyEligible = featureResult?.strongCount <= 4;
  return `${sectionIntro("4", "Data Quality Lab", "The 2,030-row training archive contains missing cells, impossible readings, wrong labels, and retry duplicates. Spend at most 15 repair credits; the system controls how each chosen repair is applied.", ["Manual Override", "Feature Hunt", "Quality Lab", "Forecast"])}
    <section class="incident-ribbon"><div><small>REPAIR POOL</small><b>${15 - spent}/15 credits</b></div><div><small>MISSING VALUES</small><b>3 credits/column · max 3</b></div><div><small>OUTLIERS</small><b>3 credits/column · max 2</b></div><div><small>RECORD REPAIRS</small><b>Labels 1 · duplicates 2</b></div></section>
    <section class="card emergency-feed ${emergencyFeed ? "selected" : ""}"><div class="panel-title">Emergency Telemetry Feed <span>Irreversible after sealing</span></div><div class="emergency-body"><div><span class="eyebrow">BACKUP RECOVERY PATH</span><h3>Available only after a failed Feature Hunt lock.</h3><p>${emergencyEligible ? "Your lock has 4 or fewer strong channels. Swap both train and test to the clean fixed 10-channel feed, forfeit Event 3, receive only 35/100 for Event 4, and cap the final-model score at 70/100. It can keep you in the game, not put you on top." : `Your ${featureResult?.strongCount ?? 0}/10 strong-channel lock is still competitive. The backup route unlocks only at 4 or fewer strong channels.`}</p></div><button id="toggle-emergency" class="btn ${emergencyFeed ? "btn--primary" : "btn--ghost"}" ${qualityResult || !emergencyEligible ? "disabled" : ""}>${emergencyFeed ? "Emergency feed selected" : "Select emergency feed"}</button></div></section>
    <section class="card"><div class="panel-title">Missing values <span>${repairs.missingColumns.size}/3 columns selected</span></div><div class="repair-grid">${repairCards("missing", qualityPlan.missingColumns)}</div></section>
    <section class="card"><div class="panel-title">Impossible outliers <span>${repairs.outlierColumns.size}/2 columns selected</span></div><div class="repair-grid">${repairCards("outlier", qualityPlan.outlierColumns)}</div></section>
    <section class="card"><div class="panel-title">Suspicious labels <span>${repairs.labelRecords.size}/6 records selected</span></div><div class="repair-grid">${repairCards("label", qualityPlan.labelCandidates)}</div></section>
    <section class="card"><div class="panel-title">Retry duplicates <span>${repairs.duplicateGroups.size}/4 groups selected</span></div><div class="repair-grid">${repairCards("duplicate", qualityPlan.duplicateGroups)}</div><div class="stage-actions"><span class="${qualityResult ? "recovery-message success" : "recovery-message"}">${esc(qualityStatus || `${spent}/15 credits committed. Repairs apply only after this event is sealed.`)}</span>${qualityResult ? `<button class="btn btn--primary" data-next="forecast">Open Event 5</button>` : `<button id="seal-quality" class="btn btn--primary">Seal Event 4 plan</button>`}</div></section>`;
}

function renderForecast() {
  const outputNames = "submission.csv · randomized_search_results.csv · best_model_evaluation.json";
  return `${sectionIntro("5", "Kaggle Forecast Handoff", "The app seals your decisions but does not train in production. Configure tuning here, then paste or download the generated Kaggle cell. It runs RandomizedSearchCV, evaluates the selected best configuration, and writes downloadable results.", ["Manual Override", "Feature Hunt", "Quality Lab", "Kaggle handoff"])}
    <section class="incident-ribbon"><div><small>FINAL TEST FEED</small><b>500 clean unseen rows</b></div><div><small>SEARCH METHOD</small><b>RandomizedSearchCV</b></div><div><small>PRIMARY METRIC</small><b>Macro F1</b></div><div><small>OUTPUTS</small><b>3 Kaggle files</b></div></section>
    <section class="card"><div class="panel-title">Model choice <span>One real scikit-learn pipeline per Kaggle run</span></div><div class="model-grid">${models.map(item => `<button class="model ${model === item[0] ? "selected" : ""}" data-model="${item[0]}"><span>RANDOMIZED SEARCH</span><b>${esc(item[0])}</b><i class="protocol-name">IMPUTE · SCALE · TUNE</i><small>${esc(item[1])}</small></button>`).join("")}</div></section>
    <section class="card"><div class="panel-title">Hyperparameter tuning brief <span>These settings are embedded in the Kaggle cell</span></div><div class="analysis-config"><label>Random-search trials<input id="tuning-trials" type="number" min="5" max="100" value="${tuning.trials}"></label><label>Stratified CV folds<input id="tuning-folds" type="number" min="3" max="10" value="${tuning.folds}"></label><label>Random seed<input id="tuning-seed" type="number" min="0" max="999999" value="${tuning.randomState}"></label><a class="btn btn--ghost" href="https://www.kaggle.com/code/new" target="_blank" rel="noreferrer">Open Kaggle notebook</a></div><div class="analysis-status">The cell searches model-specific distributions with Macro F1, refits the best parameters, then runs a second cross-validation of that selected estimator. That second figure is post-tuning—not an unbiased nested-CV estimate.</div></section>
    <section class="card"><div class="panel-title">Kaggle delivery <span>Upload the supplied traffic CSV files as a Kaggle Dataset first</span></div><div class="stage-actions"><span class="${kaggleScript ? "recovery-message success" : "recovery-message"}">${esc(forecastStatus || `The generated cell will save ${outputNames}. Kaggle renders direct download links after it finishes.`)}</span><button id="generate-kaggle" class="btn btn--primary">Generate Kaggle cell</button>${kaggleScript ? `<button id="copy-kaggle" class="btn btn--ghost">Copy cell</button>` : ""}</div>${kaggleScript ? `<pre class="analysis-status" style="margin:12px 0 0;white-space:pre-wrap;max-height:260px;overflow:auto">${esc(kaggleScript)}</pre>` : ""}</section>`;
}

function render() {
  updateChrome();
  box.innerHTML = stage === "manual" ? renderManual() : stage === "features" ? renderFeatures() : stage === "quality" ? renderQuality() : renderForecast();
  bind();
}

function toggleRepair(kind, id) {
  const key = { missing: "missingColumns", outlier: "outlierColumns", label: "labelRecords", duplicate: "duplicateGroups" }[kind], set = repairs[key], limit = qualityPlan.limits[kind], cost = qualityPlan.costs[kind];
  if (set.has(id)) set.delete(id);
  else if (set.size < limit && repairSpend() + cost <= qualityPlan.budget) set.add(id);
  else qualityStatus = set.size >= limit ? `That repair type is limited to ${limit} selections.` : `The repair would exceed the 15-credit budget.`;
  render();
}

function bind() {
  document.querySelectorAll("[data-next]").forEach(button => button.onclick = () => setStage(button.dataset.next));
  document.querySelectorAll("[data-manual]").forEach(select => select.onchange = () => { manualLabels[select.dataset.manual] = select.value; manualStatus = ""; render(); });
  const lockManual = document.querySelector("#lock-manual"); if (lockManual) lockManual.onclick = async () => { lockManual.disabled = true; try { manualResult = await request("/api/labels", { room: session.room, player: session.player, labels: manualLabels }); manualState = manualResult.manualState; manualLocked = true; manualStatus = manualResult.message; highestStage = Math.max(highestStage, 1); render(); } catch (error) { manualStatus = error.message; render(); } };
  document.querySelectorAll("[data-analysis-type]").forEach(button => button.onclick = () => { analysisType = button.dataset.analysisType; featureStatus = ""; render(); });
  const primary = document.querySelector("#analysis-feature"); if (primary) primary.onchange = () => { analysisFeature = primary.value; if (analysisSecond === analysisFeature) analysisSecond = data.features.find(name => name !== analysisFeature); render(); };
  const second = document.querySelector("#analysis-second"); if (second) second.onchange = () => { analysisSecond = second.value; };
  const analyze = document.querySelector("#run-analysis"); if (analyze) analyze.onclick = async () => { analyze.disabled = true; try { const result = await request("/api/analyze", { room: session.room, player: session.player, type: analysisType, feature: analysisFeature, secondFeature: analysisSecond, analysisState }); analysisState = result.analysisState; analysisCredits = result.creditsRemaining; const key = `${analysisType}:${analysisFeature}:${analysisSecond}`; findings = [{ key, result: result.result }, ...findings.filter(item => item.key !== key)]; featureStatus = result.replayed ? "Evidence reopened; no credits charged." : `${result.cost} credits spent. ${result.creditsRemaining} remain.`; render(); } catch (error) { featureStatus = error.message; render(); } };
  document.querySelectorAll("[data-feature]").forEach(button => button.onclick = () => { const name = button.dataset.feature; if (selectedFeatures.has(name)) selectedFeatures.delete(name); else if (selectedFeatures.size < 10) selectedFeatures.add(name); render(); });
  const lockFeatures = document.querySelector("#lock-features"); if (lockFeatures) lockFeatures.onclick = async () => { lockFeatures.disabled = true; try { featureResult = await request("/api/features", { room: session.room, player: session.player, features: [...selectedFeatures], analysisState }); featureState = featureResult.featureState; featureStatus = featureResult.message; highestStage = Math.max(highestStage, 2); const response = await request("/api/quality", { room: session.room, player: session.player, action: "plan", featureState }); qualityPlan = response.plan; render(); } catch (error) { featureStatus = error.message; render(); } };
  const emergency = document.querySelector("#toggle-emergency"); if (emergency) emergency.onclick = () => { emergencyFeed = !emergencyFeed; qualityStatus = emergencyFeed ? "Emergency feed staged. Seal the event to make the swap irreversible." : "Emergency feed deselected."; render(); };
  document.querySelectorAll("[data-repair-kind]").forEach(button => button.onclick = () => toggleRepair(button.dataset.repairKind, button.dataset.repairId));
  const sealQuality = document.querySelector("#seal-quality"); if (sealQuality) sealQuality.onclick = async () => { sealQuality.disabled = true; try { qualityResult = await request("/api/quality", { room: session.room, player: session.player, action: "seal", featureState, emergencyFeed, repairs: Object.fromEntries(Object.entries(repairs).map(([key, value]) => [key, [...value]])) }); qualityState = qualityResult.qualityState; qualityStatus = qualityResult.message; highestStage = Math.max(highestStage, 3); render(); } catch (error) { qualityStatus = error.message; render(); } };
  document.querySelectorAll("[data-model]").forEach(button => button.onclick = () => { model = button.dataset.model; kaggleScript = ""; download.disabled = true; forecastStatus = ""; render(); });
  const tuningTrials = document.querySelector("#tuning-trials"), tuningFolds = document.querySelector("#tuning-folds"), tuningSeed = document.querySelector("#tuning-seed");
  [tuningTrials, tuningFolds, tuningSeed].filter(Boolean).forEach(input => input.onchange = () => { tuning = normalizeTuning({ trials: tuningTrials.value, folds: tuningFolds.value, randomState: tuningSeed.value }); kaggleScript = ""; download.disabled = true; forecastStatus = ""; render(); });
  const generateKaggle = document.querySelector("#generate-kaggle"); if (generateKaggle) generateKaggle.onclick = () => { try { const finalRepairs = qualityResult?.emergencyFeed ? {} : Object.fromEntries(Object.entries(repairs).map(([key, value]) => [key, [...value]])); kaggleScript = buildKaggleScript({ model, features: qualityResult?.features || featureResult?.selected, emergencyFeed: Boolean(qualityResult?.emergencyFeed), repairs: finalRepairs, tuning }); download.disabled = false; forecastStatus = `${model} Kaggle cell ready. Paste it into a Kaggle notebook or download it from the top bar.`; render(); } catch (error) { forecastStatus = error.message; render(); } };
  const copyKaggle = document.querySelector("#copy-kaggle"); if (copyKaggle) copyKaggle.onclick = async () => { try { await navigator.clipboard.writeText(kaggleScript); forecastStatus = "Kaggle cell copied to the clipboard."; render(); } catch { forecastStatus = "Clipboard access was blocked. Use the download button in the top bar instead."; render(); } };
}

download.onclick = () => { if (!kaggleScript) return; const url = URL.createObjectURL(new Blob([kaggleScript], { type: "text/x-python" })), link = document.createElement("a"); link.href = url; link.download = kaggleFilename(model); link.click(); URL.revokeObjectURL(url); };
document.querySelectorAll("[data-stage]").forEach(button => button.onclick = () => setStage(button.dataset.stage));
request("/api/mission", session).then(result => {
  data = result; analysisFeature = data.features[0]; analysisSecond = data.features[1];
  statusText.textContent = `${result.mission.scope.toUpperCase()} · ROOM ${session.room} · ${result.recordCounts.trainingDelivered} TRAIN / ${result.recordCounts.finalTest} TEST`;
  render();
}).catch(error => box.innerHTML = `<div class="error-box">CLEARWAY console could not open: ${esc(error.message)}</div>`);
