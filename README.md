# Signal Lost: Operation Clearway

An interface-driven multiplayer data-science game for **Events 2–5** of Operation Clearway. A host opens a room, teams join, and every decision carries into a final 500-row traffic forecast.

The UI is adapted from **Adminator 4.3.0**, an MIT-licensed dashboard template. Vendored assets and the upstream license live in `public/vendor/adminator/`.

## Event flow

### Event 2 — Manual Override

Teams classify 50 tabular junction readings using the ordered paper protocol from `QuickRead_Briefing.pdf`:

1. `incident_distance_m < 50` → `Accident`
2. otherwise, `vehicle_count >= 25` and `avg_vehicle_speed_kmph < 25` → `Heavy_Traffic`
3. otherwise, `pedestrian_count >= 10` → `Pedestrian_Crossing`
4. otherwise → `Normal_Traffic`

The first matching rule wins. Scoring is +1 correct, −1 wrong, and 0 blank. Event 2 uses numbers only—there are no images.

### Event 3 — Feature Hunt

The supplied damaged training archive exposes 16 telemetry channels. Teams spend from a signed 10-credit investigation ledger, then lock exactly 10 channels. Available investigations are deliberately diagnostic rather than answer-revealing: basic statistics, missing-value analysis, class-wise distributions, correlations, and pair relationships.

### Event 4 — Data Quality Lab

Teams spend at most 15 repair credits within their locked feature set:

- Missing values: 3 credits per column, maximum 3 columns
- Outliers: 3 credits per column, maximum 2 columns
- Suspicious labels: 1 credit per record, maximum 6 records
- Duplicate removal: 2 credits per group, maximum 4 groups

The server applies the selected repairs to the supplied damaged archive and seals a scored repair plan.

After Event 3, only teams that locked **four or fewer strong channels** can choose the Emergency Telemetry Feed. It irreversibly swaps both train and test to the supplied clean 10-channel backup pair, forfeits all Event 3 points, limits Event 4 to 35/100, and caps the final-model component at 70/100. The fixed 6-strong + 4-weak mix is a breakout route for a failed feature lock, not a route to a winning score: even perfect Event 2 and evaluation-efficiency results can produce at most 58/100 overall.

### Event 5 — Live Grid Forecast

Teams select Decision Tree, Logistic Regression, K-Nearest Neighbors, Random Forest, or Support Vector Machine. The backend is a native Vercel Python function using a real scikit-learn `Pipeline`: `SimpleImputer` → `StandardScaler` → selected classifier. Each validation or final submission uses one slot from a shared eight-run cap. Visible evaluations use deterministic stratified five-fold Macro F1. Final submission retrains the pipeline on the full training-ready archive, predicts the clean hidden 500-row feed, and downloads:

```csv
event_id,prediction
TST_00001,Free_Flow
```

The final score follows the supplied guide: Event 2 20%, Event 3 20%, Event 4 20%, evaluation efficiency 10%, and hidden-test Macro F1 30%.

## Supplied data

`data/traffic/` contains the package files used by the server:

- `train_16.csv`: 2,030 delivered rows, 16 features, deliberately damaged
- `train_clean_16.csv`: organizer-side 2,000-row canonical archive
- `test_16.csv`: clean 500-row hidden feed without labels
- `test_truth.csv`: server-side final answer key
- `train_backup_10.csv` and `test_backup_10.csv`: matching clean backup tier
- corruption, feature-strength, backup-list, and generation metadata

Organizer truth files are not exposed by a public HTTP route. For a real competition, keep the repository/private deployment boundary appropriate so participants cannot read organizer assets from source control.

## Architecture

```text
Player / host browser
        │
        ├── Vercel static client
        └── Vercel API routes
              ├── Supabase rooms and shared evaluation cap
              ├── signed Event 2 / 3 / 4 state seals
              ├── server-side dataset diagnostics and repairs
              └── Python/scikit-learn pipeline, five-fold validation, and hidden scoring
```

The earlier weighted admission-router prototype remains in `/api/join` and `/api/heartbeat`; the current room flow uses Supabase-backed rooms and Vercel functions.

## Local setup

Requirements: Node.js 20+, Python 3.12, and the Vercel CLI.

```bash
npm install
python -m pip install -r requirements.txt
vercel env pull .env.local
npx vercel dev
```

Create a room at `/host.html`, join from `/`, and start the room from the host console.

For Supabase, run `supabase/room_schema.sql`, then configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and server-only `SUPABASE_SECRET_KEY`. Set `CLEARWAY_STATE_SECRET` in production so signed progression tokens do not use the local development fallback.

## Validation

```bash
npm test
python -m unittest discover -s tests -p "test_*.py" -v
node --check public/game.js
python -m py_compile api/run.py api/ml_pipeline.py
```

The tests cover dataset scale/parity, Manual Override priority/scoring, signed Feature Hunt state, repair-budget enforcement, the emergency feed, all five forecast models, hidden 500-row submission output, and the admission router.
