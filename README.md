# Five Nights at Morgridge (working name during the build: NullSpace)

Playable Floors 1-2 demo built from `nullspace_build_spec_v2.md`. Runs fully offline.

```
npm install
npm run dev        # play locally
npm run build      # tsc + single-file dist/index.html
npm test           # metrics unit tests
```

Add `?speed=4` to the URL to test a night 4x faster.

## What is here
- `src/core/` pure TypeScript game rules (no React/DOM): clock, power, doors, lights, seeded sentinel path, seeded lie pattern, task resolution -> `GameEvent`, local Mirror metrics.
- `src/data/` the 5 tasks, C.A.I.-0 fallback lines per task x tactic, a SYNTHETIC seed cohort.
- `src/services/api.ts` calls our backend only. Set `VITE_API_URL` to turn on `POST /api/run/start`, `/api/event`, `/api/run/end`. Without it, local lines + local metrics.
- `src/ui/` React skin: StartScreen, SecurityDesk, CameraGrid, MirrorReport.

## Backend (Databricks)
```
cd server
cp .env.example .env          # paste DATABRICKS_HOST, DATABRICKS_WAREHOUSE_ID, DATABRICKS_TOKEN
python3 -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
Check http://localhost:8000/api/health, then in the project root create `.env.local` with
`VITE_API_URL=http://localhost:8000` and run `npm run dev`.

Each finished run writes 1 row to `runs` and 5 rows to `events`, and the Mirror Report comparison runs in SQL
(`server/sql/mirror_metrics.sql`). If the backend is down or slow (8s), the game uses its local report.

## Not built yet
- Model Serving call for the Mirror Report text, Genie space, AI/BI dashboard, storyboard.
- The room's mirror is shown only after a run (never on the start screen or in-game). `GET /api/room` exists for a second-screen view but is not wired.

## C.A.I.-0's memory (Databricks is part of the game)
When a night starts, `POST /api/run/start` asks Databricks how often each task was accepted without checking
(`MEMORY_SQL` in `server/main.py`). C.A.I.-0 puts its 3 lies on the late tasks the room hands over most.
Tasks 1 and 2 stay honest. It needs at least 3 saved nights to learn; before that, or if Databricks is slow
(3s), the game uses the seeded random pattern. The report tells the player which tasks were chosen and why.
The memory is cached on the server and refreshed after every finished night.

## Design changes after playtests (Nov 14)
- Seven tasks (`src/data/tasks.ts`), each a thing people hand to AI in daily life, placed in the night shift.
  Core and UI switch on `task.kind` (`note`, `math`, `code`, `cam`, `rank`, `radio`, `door`), not on the task number.
- C.A.I.-0 is honest on tasks 1 and 2, then lies on 3 of tasks 3 to 7 (which ones is seeded from run_id).
- No task has a timer. The night clock never stops, so the units keep moving while the player decides.
  If a task is still open when the next comes due, the next one waits. Tasks not reached by 2:00 AM are not logged.
- The cam task is settled by looking: opening CAM 03 by any route logs "checked, then did it yourself".
- Lights removed. Four cameras: CAM 01 = Door L, CAM 02 = Door R, CAM 03, CAM 04. The monitor's home view is a security map.
- Black unit reaches a door when the door task comes due and waits `attackWindowMs(night)` (9s on night 1).
  White unit joins on floor 2 and tries a door near 2:00 AM with no offer from C.A.I.-0.
- Night 1 power is generous; `powerScale(night)` in `src/core/gameState.ts` makes later nights drain faster. Power out = caught.
- The choice buttons are styled identically. The room's mirror is shown only after a run.
- Shift lengths: short 3 min, full 5 min. Keys: `1-4` cameras, `M` map, `A`/`D` doors, `Enter` accept, `Space` do it myself, `C` check.
- Rows saved before this version used 5 tasks. Clear them before judging:
  `TRUNCATE TABLE workspace.nullspace.events; TRUNCATE TABLE workspace.nullspace.runs;`

## Deviations from the spec to decide on
- `pressure_s` is now always null and `timed_out` always false (columns kept so the table schema is unchanged).
- Task 2 says "backup circuit holds a 20% reserve" so it does not contradict the live POWER readout.
- Plain CSS instead of Tailwind. Sound is synthesized placeholder (`src/ui/sfx.ts`), swap for SFX files.
- `src/data/seedCohort.ts` rates are invented placeholders. Replace with real runs before judging.
- The map in `src/ui/MorgridgeMap.tsx` is a simplified drawing made for the game, not a copy of the architect's plan.
