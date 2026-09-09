const MODEL_CONFIGS = {
  "Decision Tree": {
    classifier: "DecisionTreeClassifier(random_state=RANDOM_STATE)",
    space: `{
    "classifier__criterion": ["gini", "entropy", "log_loss"],
    "classifier__max_depth": [4, 6, 8, 12, None],
    "classifier__min_samples_split": randint(2, 25),
    "classifier__min_samples_leaf": randint(1, 12),
    "classifier__class_weight": [None, "balanced"],
}`
  },
  "Logistic Regression": {
    classifier: "LogisticRegression(max_iter=2500, random_state=RANDOM_STATE)",
    space: `{
    "classifier__C": loguniform(1e-3, 1e2),
    "classifier__solver": ["lbfgs", "saga"],
    "classifier__penalty": ["l2"],
    "classifier__class_weight": [None, "balanced"],
}`
  },
  "K-Nearest Neighbors": {
    classifier: "KNeighborsClassifier()",
    space: `{
    "classifier__n_neighbors": randint(3, 55),
    "classifier__weights": ["uniform", "distance"],
    "classifier__p": [1, 2],
    "classifier__leaf_size": randint(15, 61),
}`
  },
  "Random Forest": {
    classifier: "RandomForestClassifier(random_state=RANDOM_STATE, n_jobs=1)",
    space: `{
    "classifier__n_estimators": randint(200, 701),
    "classifier__max_depth": [6, 10, 16, 24, None],
    "classifier__min_samples_split": randint(2, 21),
    "classifier__min_samples_leaf": randint(1, 9),
    "classifier__max_features": ["sqrt", "log2", None],
    "classifier__class_weight": [None, "balanced", "balanced_subsample"],
}`
  },
  "Support Vector Machine": {
    classifier: "SVC(kernel=\"rbf\", random_state=RANDOM_STATE)",
    space: `{
    "classifier__C": loguniform(1e-3, 1e2),
    "classifier__gamma": loguniform(1e-4, 1e0),
    "classifier__class_weight": [None, "balanced"],
}`
  }
};

const FEATURE_RANGES = {
  vehicle_count: [0, 90], avg_vehicle_speed_kmph: [0, 90], road_occupancy_pct: [0, 100], pedestrian_count: [0, 70],
  time_of_day_hr: [0, 24], visibility_m: [25, 3000], rain_intensity_mmhr: [0, 45], signal_wait_time_s: [0, 200],
  road_wetness_pct: [0, 100], incident_distance_m: [1, 500], noise_level_db: [35, 100], ambient_temperature_c: [2, 45],
  humidity_pct: [15, 100], camera_exposure_score: [0, 100], camera_focus_score: [0, 100], lane_marking_visibility_pct: [0, 100]
};

const clampInt = (value, fallback, low, high) => Math.max(low, Math.min(high, Number.parseInt(value, 10) || fallback));
const identifiers = values => [...new Set(Array.isArray(values) ? values : [])].filter(value => typeof value === "string" && /^[a-z][a-z0-9_]*$/i.test(value));
const repairIds = values => [...new Set(Array.isArray(values) ? values : [])].filter(value => typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value));

export function normalizeTuning(raw = {}) {
  return {
    trials: clampInt(raw.trials, 25, 5, 100),
    folds: clampInt(raw.folds, 5, 3, 10),
    randomState: clampInt(raw.randomState, 42, 0, 999999)
  };
}

export function kaggleFilename(model) {
  return `${String(model).toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "") || "model"}-randomized-search.py`;
}

export function buildKaggleScript({ model, features, emergencyFeed = false, repairs = {}, tuning = {} }) {
  const config = MODEL_CONFIGS[model];
  if (!config) throw new Error("Choose one of the approved models.");
  const safeFeatures = identifiers(features);
  if (safeFeatures.length !== 10) throw new Error("The Kaggle handoff requires exactly ten locked features.");
  const settings = normalizeTuning(tuning);
  const safeRepairs = {
    missingColumns: identifiers(repairs.missingColumns),
    outlierColumns: identifiers(repairs.outlierColumns),
    labelRecords: repairIds(repairs.labelRecords),
    duplicateGroups: repairIds(repairs.duplicateGroups)
  };
  const trainFile = emergencyFeed ? "train_backup_10.csv" : "train_16.csv";
  const testFile = emergencyFeed ? "test_backup_10.csv" : "test_16.csv";

  return `# Operation Clearway — Kaggle training cell
# Upload the supplied traffic CSV files as a Kaggle Dataset, then run this cell.
# It tunes ${model} with RandomizedSearchCV and writes downloadable results.

import json
from pathlib import Path

import numpy as np
import pandas as pd
from IPython.display import FileLink, display
from scipy.stats import randint, loguniform
from sklearn.base import clone
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score
from sklearn.model_selection import RandomizedSearchCV, StratifiedKFold, cross_val_score
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier

MODEL_NAME = ${JSON.stringify(model)}
FEATURES = ${JSON.stringify(safeFeatures, null, 2)}
FEATURE_RANGES = ${JSON.stringify(FEATURE_RANGES, null, 2)}
REPAIRS = ${JSON.stringify(safeRepairs, null, 2)}
N_ITER = ${settings.trials}
CV_FOLDS = ${settings.folds}
RANDOM_STATE = ${settings.randomState}
TRAIN_FILE = ${JSON.stringify(trainFile)}
TEST_FILE = ${JSON.stringify(testFile)}

def locate_file(name):
    matches = sorted(Path("/kaggle/input").rglob(name))
    if not matches:
        raise FileNotFoundError(f"Upload {name} to a Kaggle Dataset before running this cell.")
    return matches[0]

train = pd.read_csv(locate_file(TRAIN_FILE))
test = pd.read_csv(locate_file(TEST_FILE))

# Reproduce the sealed Event 4 repair plan before tuning.
if REPAIRS["duplicateGroups"]:
    train = train.loc[~train["event_id"].isin(REPAIRS["duplicateGroups"])].copy()

if REPAIRS["labelRecords"]:
    log = pd.read_csv(locate_file("corruption_log.csv"))
    label_map = (log.loc[log["problem"].eq("wrong_label"), ["event_id", "original_value"]]
                   .drop_duplicates("event_id").set_index("event_id")["original_value"])
    repair_mask = train["event_id"].isin(REPAIRS["labelRecords"])
    train.loc[repair_mask, "label"] = train.loc[repair_mask, "event_id"].map(label_map).fillna(train.loc[repair_mask, "label"])

for feature in FEATURES:
    low, high = FEATURE_RANGES[feature]
    values = pd.to_numeric(train[feature], errors="coerce")
    valid = values[values.between(low, high)]
    median = valid.median()
    if feature in REPAIRS["missingColumns"]:
        train[feature] = values.fillna(median)
    else:
        train[feature] = values.fillna(low - (high - low) * 0.25)
    if feature in REPAIRS["outlierColumns"]:
        train[feature] = train[feature].clip(low, high)

X = train[FEATURES].apply(pd.to_numeric, errors="coerce")
y = train["label"].astype(str)
X_test = test[FEATURES].apply(pd.to_numeric, errors="coerce")

classifier = ${config.classifier}
pipeline = Pipeline([
    ("imputer", SimpleImputer(strategy="median")),
    ("scaler", StandardScaler()),
    ("classifier", classifier),
])
param_distributions = ${config.space}
cv = StratifiedKFold(n_splits=CV_FOLDS, shuffle=True, random_state=RANDOM_STATE)

search = RandomizedSearchCV(
    estimator=pipeline,
    param_distributions=param_distributions,
    n_iter=N_ITER,
    scoring="f1_macro",
    cv=cv,
    n_jobs=-1,
    random_state=RANDOM_STATE,
    refit=True,
    return_train_score=True,
    verbose=1,
)
search.fit(X, y)

# Evaluate the refitted best configuration. This is a post-tuning CV score;
# use nested CV if you need an unbiased model-selection estimate.
best_cv_scores = cross_val_score(clone(search.best_estimator_), X, y, cv=cv, scoring="f1_macro", n_jobs=-1)
evaluation = {
    "model": MODEL_NAME,
    "best_params": search.best_params_,
    "search_best_macro_f1": float(search.best_score_),
    "best_model_cv_macro_f1_mean": float(best_cv_scores.mean()),
    "best_model_cv_macro_f1_std": float(best_cv_scores.std()),
    "n_iter": N_ITER,
    "folds": CV_FOLDS,
    "random_state": RANDOM_STATE,
    "training_rows": int(len(train)),
}
print(json.dumps(evaluation, indent=2, default=str))

results = pd.DataFrame(search.cv_results_).sort_values("rank_test_score")
result_columns = [column for column in ["rank_test_score", "mean_test_score", "std_test_score", "mean_train_score", "params"] if column in results]
results.loc[:, result_columns].to_csv("randomized_search_results.csv", index=False)
with open("best_model_evaluation.json", "w", encoding="utf-8") as output:
    json.dump(evaluation, output, indent=2, default=str)

submission = pd.DataFrame({"event_id": test["event_id"], "prediction": search.predict(X_test)})
submission.to_csv("submission.csv", index=False)
print("Saved submission.csv, randomized_search_results.csv, and best_model_evaluation.json")
display(FileLink("submission.csv"))
display(FileLink("randomized_search_results.csv"))
display(FileLink("best_model_evaluation.json"))
`;
}
