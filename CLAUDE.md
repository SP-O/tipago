# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

티파고 (formerly 티카투카 어시스턴트): a static web app that, given the current board of the **티카투카** dice game (played against an in-game AI), recommends the highest-win-probability move and shows a win %. Pure ES-module JavaScript — no build step, no runtime dependencies. Vue 3 is loaded from a CDN as a global; everything else is hand-rolled and runs unchanged in both the browser and Node (tests import the same `src/` modules).

Deployed to Vercel from GitHub `SP-O/tipago` (branch `main`, auto-deploy on push).

## Commands

```bash
npm test                              # run all tests (= node --test, needs Node 18+)
node --test tests/recommend.test.js   # run a single test file
node --check app.js                   # syntax-check a file before committing

python -m http.server 5500            # serve locally — MUST be HTTP, not file://
                                      # (the solver runs in a module Web Worker)
```

There is no lint or build step. After editing solver/UI code, the standard check is `node --check` on changed files + `npm test` (expect the full suite to pass).

## Architecture

Three layers, all sharing the same pure modules:

1. **Game core** (`src/`) — no search, no UI. `state.js` (state shape + clone/`remainingEmpty`), `rules.js` (legal moves, `wouldTriggerAlkkagi`/`resolveAlkkagi`, `placeDie`, mitjang), `scoring.js` (`lineSum`, `gameResult`). These are the single source of truth for the rules; the solver and UI both build on them.
2. **Solver** (`src/solver/`) — runs inside a module Web Worker (`worker.js`), called from the page via `solveAsync` in `app.js`.
3. **UI** (`index.html`, `app.js`, `styles.css`) — Vue 3 app mounted on `#app`.

### Solver flow (the important part)

`recommend(state, die, opts)` in `src/solver/recommend.js` is the orchestrator. It picks an evaluation strategy based on how full the board is and the options passed:

- **Endgame → exact** (`exact.js`): expectiminimax — `me` nodes maximize, `opp` nodes minimize, dice are chance (average over 1–6). Used when `remainingEmpty(state) <= EXACT_THRESHOLD` (4, or 6 in 정밀 모드). Models the optimal opponent **and** mitjang reroll. Guarded by a global `NODE_LIMIT` (200000) that throws `ExactBudgetError`; `recommend` catches it and falls back to Monte-Carlo. **This is the only path where `opp.hasMitjang` ("상대 밑장빼기 사용") affects the answer** — rollouts ignore it.
- **Midgame → Monte-Carlo** (`montecarlo.js`): flat rollouts with a greedy policy + heuristic leaf eval. Also used whenever `realAI` is on (so the opponent rollout uses the real-AI policy instead of an optimal one).
- **Leaf heuristic** (`evaluate.js`): `lineWinProb` = logistic of the line margin, where margin is adjusted by `removableValue` (value-weighted alkkagi potential — a non-shield die group's score contribution). `heuristicValue` combines the three lines via `pAtLeastTwo` (P of winning ≥2 of 3 lines). `greedyMove` is the default rollout policy; `aiOpponentMove` is the "B-lite" real-AI model (alkkagi-priority → avoid-2-die-lines → greedy); `greedyBonusPlace` places the post-alkkagi bonus die.

`recommend` returns `{ options (win-prob desc), best, mitjang }`. When `opts.isBonus`, it evaluates placing a shielded bonus die on **either** field (`emptyTargets`) instead of a normal my-field placement.

### Game rules encoded here (match these exactly)

- **Line score** (`lineSum`): a value present once = its face; twice (double) = `3×value`; three times (triple) = `5×value`. Summed across distinct values in the line.
- **Win** (`gameResult`): win ≥2 of 3 lines. On a tie in lines won, the higher **total sum across all three fields** wins; equal totals = draw.
- **Alkkagi** (`wouldTriggerAlkkagi`/`resolveAlkkagi`): placing value V on your line knocks out the opponent's **same-line, same-value, non-shield** dice. Requires your line to have space. **Shielded dice are immune.** Triggering grants a bonus die (random, shielded, placeable on either field).
- **Mitjang (밑장빼기)**: once-per-game reroll; you may keep either the original or the new value (modeled as a max/min over reroll outcomes in `exact.js` `turnValueExact`).
- Board is 18 slots total (2 players × 3 lines × 3 dice); game ends when full.

### Board representation & the left/right mirror

Lines are **packed arrays** (no empty holes): `[{value, shield}, ...]`, index 0 = first die placed. The UI mirrors the in-game layout — my field on the left fills **right-to-left**, opponent on the right fills **left-to-right**. `src/ui-layout.js` (`cellToDieIndex`, `dieIndexToCell`, `nextFillCell`) is the only place that maps screen cells ↔ packed die indices; keep that mapping isolated there.

### Experimental learned models (currently OFF by default)

Two learned-model subsystems exist but are **disabled** because neither beat the classic solver (for a game this small, exhaustive search is near the ceiling):

- **Value-NN** (`net.js`, `encode.js`, `nn-train.js`, `nn-search.js`): hand-rolled MLP used as a leaf eval in depth-limited expectiminimax. Reachable only via `opts.useNN`, which makes `worker.js` lazily `fetch('./model.json')` and tag the result `engine: 'nn'`. It gave out-of-distribution value errors (e.g. mis-rating opponent-field bonus placements), so the default is `engine: 'classic'`.
- **AlphaZero** (`az-net.js`, `az-encode.js`, `mcts.js`, `az-selfplay.js`): full policy+value net + PUCT MCTS with chance nodes + self-play, gated by a head-to-head acceptance test (≥55% vs classic) that it never passed. Not wired into the worker.

Treat `classic` (exact + MC) as the production engine. Improve recommendations by tuning the heuristic / search, not by reaching for the NN.

## Conventions & gotchas

- **No dependencies, no transpile.** Code must run as-is in the browser and under Node `--test`. Don't add npm packages or import anything that isn't another `src/` file or a `node:` builtin (tests only).
- **Determinism via seeded RNG.** `makeRng(seed)` (mulberry32) — every Monte-Carlo evaluation takes an explicit rng so results are reproducible. `recommend` derives per-option seeds from `opts.seed` (default 1234567). Don't introduce `Math.random()` into the solver.
- **The Worker boundary is plain structured-clone messages.** `app.js` `buildEngineState()` converts the reactive UI board into the engine's `{ me:{lines,hasMitjang}, opp:{...}, turn }` shape; `opts` carries `{ isBonus, seed, precise, realAI }`. Keep both sides in sync when changing the message shape.
- **Tests are the regression net for solver quality**, not just correctness — e.g. `tests/recommend.test.js` asserts specific recommendations (alkkagi gets chosen in a known endgame). Add a failing-case test when fixing a "weird recommendation" before changing the heuristic.
- **Commit messages**: PowerShell here-strings choke on `→` and embedded quotes — use single-line ASCII-safe messages (Korean text without arrows/quotes is fine).
