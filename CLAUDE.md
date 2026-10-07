# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev       # Vite dev server (no API; sync will report an error, board still works)
npm run build     # tsc -b (type-check via project references) then vite build -> dist/
npm run preview   # serve the built dist/
npm run lint      # eslint . (flat config in eslint.config.js)
npm test          # vitest run
npm run test:watch

cd api && npm install && npm run build   # the Functions API compiles separately
```

`npm run build` is the type-check gate: `tsc -b` fails the build on type errors. The GitHub
Actions workflow runs lint, test, and build before anything deploys.

To exercise the API locally you need the Static Web Apps CLI and Azure Functions Core Tools:

```bash
npm run build
cd api && npm run build && cd ..
npx @azure/static-web-apps-cli start dist --api-location api
```

Copy `api/local.settings.sample.json` to `api/local.settings.json` and fill in
`COSMOS_CONNECTION_STRING` first. `local.settings.json` is gitignored and must stay that way.

## Architecture

A React 19 + Vite + TypeScript PWA: a Trello-shaped board of lists and cards, where a card can
carry a description, subtasks, and a daily/weekly/monthly/yearly recurrence.

**localStorage is the working copy.** Every read and write the UI performs goes to
localStorage, which is what makes the board instant and fully usable offline. Azure is a sync
target, never the read path. This is a deliberate choice, not an optimisation: Azure SQL's free
tier was rejected for this app because it bills by awake wall-clock time, and Cosmos was chosen
partly because it has no cold start.

Data flow:

```
UI -> dispatch -> reducer (src/lib/store.ts) -> localStorage (src/lib/storage.ts)
                                 |
                      debounced push (2s) / pull on open
                                 v
                   /api/sync -> Cosmos DB container "items"
```

### The parts that matter

- `src/lib/types.ts` — the data model. `Item = BoardList | Card`. Every syncable entity has
  `updatedAt` (drives last-write-wins) and `deletedAt` (a tombstone).
- `src/lib/store.ts` — the reducer. **Every mutation goes through `patchCard` / `patchList`,
  which stamp `updatedAt` and add the id to `dirty` together.** Do not mutate board state
  outside those helpers; sync correctness depends on both happening on every write.
- `src/lib/recurrence.ts` — all recurrence maths, done on **local-time date parts only**. Never
  add milliseconds to a date here: it works until the clocks change, then daily cards start
  resetting at 11pm. Completing a card and rolling it into the next period are deliberately
  separate operations (`addCompletion` vs `rollCardForward`).
- `src/lib/merge.ts` — last-write-wins merge for sync pulls, plus position arithmetic.
- `src/lib/storage.ts` — localStorage plus `coerce*` validators. Everything read back from
  storage is re-validated, because it may have been written by an older version of the app.
- `src/hooks/BoardProvider.tsx` — hydration, persistence, and sync scheduling. The persist
  effect is gated on `state.hydrated` so the first render cannot write an empty board over
  stored data.
- `api/src/functions/sync.ts` — the only endpoint. GET returns items changed since a watermark;
  POST upserts with the same last-write-wins rule, then returns the server's current view.

### Invariants worth not breaking

- **Deletes are tombstones.** Removing an item outright means the other device's next push
  resurrects it.
- **`updatedAt` is always `toISOString()` form.** The `since` filter compares it as a string in
  Cosmos SQL, which is only chronologically correct at fixed-width UTC. `api/src/model.ts`
  normalises every incoming value for this reason.
- **The LWW comparison is duplicated** in `src/lib/merge.ts` and `api/src/model.ts` because the
  API builds as its own package. Change both together.
- **`userId` comes from the `x-ms-client-principal` header**, never from the request body. The
  client leaves it blank and the server fills it in.
- **Cosmos throughput sits on the database (400 RU/s shared), not the container.** Giving a
  container dedicated throughput is what turns a free-tier account into a billed one.

## Tests

Vitest covers the places where bugs are silent and expensive: recurrence maths
(`src/lib/recurrence.test.ts`), merge/reducer behaviour (`merge.test.ts`, `store.test.ts`), and
the API's request validation (`api/src/model.test.ts`, run by the root `npm test` even though
`api/` builds separately — `api/tsconfig.json` excludes test files from its own build).
There is no component testing; the UI is exercised by hand or with Playwright. `vite.config.ts` pins `TZ=America/Denver` for the suite so DST
transitions are genuinely exercised; a guard test fails loudly if that stops being true.

## Deployment

Azure Static Web Apps, via `.github/workflows/azure-static-web-apps.yml` on every push to
`main` (PRs get preview environments, torn down on close). The client is built in the workflow
and uploaded with `skip_app_build: true`; Oryx builds `api/`.

`staticwebapp.config.json` restricts `/api/*` to the `authenticated` role, rewrites unknown
routes to `/index.html`, and pins the API runtime to `node:22`. If you add new static files at
the root of `public/`, add them to the `navigationFallback.exclude` list.

Required configuration in the Azure portal (Static Web App → Environment variables):
`COSMOS_CONNECTION_STRING`, and optionally `COSMOS_DATABASE` / `COSMOS_CONTAINER`.
