# Expedition Unknown

A Kahoot-style, multiplayer data-science game built for Vercel. Players join a host-controlled room, work through a server-selected wine-quality dataset, and produce a final `submission.csv`.

**Live player app:** https://expedition-unknown-game.vercel.app  
**Host console:** https://expedition-unknown-game.vercel.app/host.html

## What players do

The game has five stages:

1. **Data recovery** — investigate six intercepted transmissions, classify each as trusted or quarantined from its SHA-256 fingerprint, then reconstruct a 200-record data package from approved fragments.
2. **Data labelling** — label 50 records whose labels are hidden from the client.
3. **Feature hunt** — choose exactly 8 features using a limited investigation budget.
4. **Quality lab** — spend repair credits on server-side data-quality fixes.
5. **ML arena** — run fixed validation for five models and export `submission.csv`.

The server deterministically chooses one of the UCI Wine Quality datasets per room. The 100 final-test labels never reach the client.

## Recovery Bin: how the first stage works

Mission Control publishes an approved transmission manifest. Each intercepted file has its own received SHA-256 fingerprint, a row range, a column set, and a plain-language description.

Players must first classify every transmission as **Trusted** or **Quarantine**. The server verifies this chain-of-custody decision. Only then can they select row ranges and columns from trusted fragments. The server rejects unapproved fingerprints, transit metadata, conflicting cells, incomplete feature coverage, and bad labels; it finally validates the reconstructed package against a canonical SHA-256 checksum.

Three hint credits are available per player/room browser session. A failed classification or reconstruction consumes one credit and returns a targeted hint.

## Architecture

```text
Player / Host browser
        │
        ├── Vercel static client
        └── Vercel API routes
              ├── Supabase Postgres: rooms, host tokens, player roster
              ├── server-selected dataset and recovery validation
              └── model evaluation and submission generation
```

The project also includes the earlier GLBP-style admission router prototype (`/api/join`, `/api/heartbeat`) for weighted, sticky routing across externally hosted game fleets. The current game room flow uses Supabase-backed rooms and Vercel API routes.

## Local setup

Requirements: Node.js 20+ and the Vercel CLI.

```bash
npm install
vercel env pull .env.local
npm run dev
```

Open the local Vercel URL, create a room from `/host.html`, then join from the root page.

## Supabase setup

1. Create a Supabase project.
2. In the Supabase SQL Editor, run [`supabase/room_schema.sql`](supabase/room_schema.sql).
3. Add these Vercel environment variables for Production, Preview, and Development:

```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_publishable_or_anon_key
SUPABASE_SECRET_KEY=your_service_role_key
```

`SUPABASE_SECRET_KEY` is server-only. Never expose it in client-side code or commit it to Git.

## Deploy

```bash
vercel --prod
```

After deployment, verify that the player URL loads, the host can create a room, a player can join, and a valid Recovery Bin reconstruction succeeds.

## Project layout

```text
api/                 Vercel API routes and server-side game logic
data/                UCI Wine Quality source CSVs
public/              player, host, and game UI
supabase/            room schema and RPC functions
tests/               router tests
vercel.json          Vercel configuration and server function includes
```

## Validation

```bash
npm test
node --check public/game.js
node --check api/recovery.js
```

## Dataset and license

The game uses the [UCI Wine Quality dataset](https://archive.ics.uci.edu/dataset/186/wine+quality), licensed CC BY 4.0. The original event design reference is not included in this repository.
