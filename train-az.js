// AlphaZero 학습 스크립트 — PC에서 실행: `node train-az.js`
// self-play(MCTS) → 정책+가치 학습 → 규칙 기반 솔버와 head-to-head 게이트.
// 게이트(승률 >= 55%)를 넘을 때만 az-model.json 저장(더 나쁜 모델 출시 방지).
// 환경변수: TK_AZ_ITERS, TK_AZ_GAMES, TK_AZ_SIMS, TK_AZ_HIDDEN, TK_AZ_EVAL, TK_AZ_STEPS

import fs from 'node:fs';
import { createState, boardFull } from './src/state.js';
import { gameResult } from './src/scoring.js';
import { legalLines, emptyTargets, wouldTriggerAlkkagi, resolveAlkkagi, placeDie, endTurn } from './src/rules.js';
import { makeRng, rollDie } from './src/solver/evaluate.js';
import { createAzNet, azAdamInit, azTrainBatch, serializeAz, deserializeAz } from './src/solver/az-net.js';
import { AZ_INPUT_SIZE, actionToTarget, targetToAction } from './src/solver/az-encode.js';
import { mctsSearch } from './src/solver/mcts.js';
import { selfPlayGame } from './src/solver/az-selfplay.js';
import { recommend } from './src/solver/recommend.js';

const num = (k, d) => (process.env[k] ? Number(process.env[k]) : d);
const CFG = {
  hidden: num('TK_AZ_HIDDEN', 128),
  iterations: num('TK_AZ_ITERS', 30),
  gamesPerIter: num('TK_AZ_GAMES', 20),
  sims: num('TK_AZ_SIMS', 60),
  trainSteps: num('TK_AZ_STEPS', 200),
  batchSize: 64,
  bufferSize: 30000,
  lr: 0.01,
  evalGames: num('TK_AZ_EVAL', 30),
  turnCap: 60,
  seed: num('TK_AZ_SEED', 777),
  modelPath: './src/solver/az-model.json',
};

function azAction(net, state, phase, die, mover, sims, rng) {
  const res = mctsSearch(net, state, phase, die, { sims, rng, mover });
  const t = res.best.target;
  return targetToAction(t.side, t.lineIndex);
}

function classicAction(state, phase, die, mover, rng) {
  const swap = mover === 'opp';
  const s = swap ? { me: state.opp, opp: state.me, turn: 'me' } : state;
  const r = recommend(s, die, { isBonus: phase === 'bonus', seed: Math.floor(rng() * 1e9) });
  const t = r.best.target;
  const realSide = swap ? (t.side === 'me' ? 'opp' : 'me') : t.side;
  return targetToAction(realSide, t.lineIndex);
}

// AZ('me') vs 규칙기반('opp') 한 판. 결과 반환('me'/'opp'/'draw').
function playMatchGame(net, sims, rng, cfg) {
  let state = createState({ turn: rng() < 0.5 ? 'me' : 'opp' });
  state.me.hasMitjang = false;
  state.opp.hasMitjang = false;
  let firstDie = true;
  let turns = 0;
  while (!boardFull(state) && turns < cfg.turnCap) {
    const mover = state.turn;
    if (legalLines(state, mover).length === 0) { state = endTurn(state); turns += 1; continue; }
    const die = rollDie(rng);
    const choose = mover === 'me' ? azAction(net, state, 'normal', die, mover, sims, rng) : classicAction(state, 'normal', die, mover, rng);
    const L = actionToTarget(choose).lineIndex;
    if (wouldTriggerAlkkagi(state, mover, L, die)) {
      const s1 = resolveAlkkagi(state, mover, L, die);
      if (emptyTargets(s1).length === 0) { state = endTurn(s1); firstDie = false; turns += 1; continue; }
      const b = rollDie(rng);
      const ba = mover === 'me' ? azAction(net, s1, 'bonus', b, mover, sims, rng) : classicAction(s1, 'bonus', b, mover, rng);
      const t = actionToTarget(ba);
      state = endTurn(placeDie(s1, t.side, t.lineIndex, { value: b, shield: true }));
    } else {
      state = endTurn(placeDie(state, mover, L, { value: die, shield: firstDie }));
    }
    firstDie = false;
    turns += 1;
  }
  return gameResult(state);
}

function gate(net, sims, games, rng, cfg) {
  let score = 0;
  for (let g = 0; g < games; g++) {
    const r = playMatchGame(net, sims, rng, cfg);
    score += r === 'me' ? 1 : r === 'draw' ? 0.5 : 0;
  }
  return score / games;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function main() {
  const cfg = CFG;
  const rng = makeRng(cfg.seed);
  const net = createAzNet([AZ_INPUT_SIZE, cfg.hidden, cfg.hidden], 6, rng);
  const adam = azAdamInit(net);
  const buffer = [];
  let bestWin = -1;

  console.log(`AZ 학습 시작: iters=${cfg.iterations} games=${cfg.gamesPerIter} sims=${cfg.sims} hidden=${cfg.hidden} eval=${cfg.evalGames} | 게이트=규칙기반 솔버 상대 승률>=55%`);
  for (let iter = 1; iter <= cfg.iterations; iter++) {
    const t0 = Date.now();
    for (let g = 0; g < cfg.gamesPerIter; g++) {
      const sp = selfPlayGame(net, rng, { sims: cfg.sims, temperature: 1.0, noiseEps: 0.25, turnCap: cfg.turnCap });
      for (const e of sp.examples) buffer.push(e);
    }
    while (buffer.length > cfg.bufferSize) buffer.shift();

    let loss = 0;
    for (let s = 0; s < cfg.trainSteps; s++) {
      shuffle(buffer, rng);
      loss = azTrainBatch(net, buffer.slice(0, Math.min(cfg.batchSize, buffer.length)), adam, { lr: cfg.lr });
    }

    const win = gate(net, cfg.sims, cfg.evalGames, rng, cfg);
    let tag = '미달';
    if (win >= 0.55 && win > bestWin) { bestWin = win; fs.writeFileSync(cfg.modelPath, serializeAz(net)); tag = '✅채택(저장)'; }
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[${iter}/${cfg.iterations}] loss=${loss.toFixed(4)} buf=${buffer.length} vs규칙기반=${(win * 100).toFixed(0)}% ${tag} (${dt}s)`);
  }
  if (bestWin < 0.55) console.log('게이트 미통과: 규칙 기반 솔버를 못 이겼습니다 → classic 유지(모델 미저장). 이 작은 게임은 규칙 기반이 천장일 수 있음.');
  else console.log(`학습 완료 → 최고 승률 ${(bestWin * 100).toFixed(0)}%, ${cfg.modelPath} 저장됨`);
}

main();
