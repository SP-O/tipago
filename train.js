// 티카투카 자가학습(self-play) 학습 스크립트 — PC에서 실행: `node train.js`
// 학습량은 환경변수로 조절: TK_ITERS, TK_GAMES (예: TK_ITERS=10 TK_GAMES=20 node train.js)
// 산출물: src/solver/model.json (브라우저가 불러 쓸 가중치)

import fs from 'node:fs';
import { createState, boardFull } from './src/state.js';
import { gameResult, outcomeValue } from './src/scoring.js';
import { encode } from './src/solver/encode.js';
import { createNet, serialize, deserialize } from './src/solver/net.js';
import { adamInit, trainBatch } from './src/solver/nn-train.js';
import { executeTurn } from './src/solver/nn-search.js';
import { makeRng } from './src/solver/evaluate.js';

const num = (k, d) => (process.env[k] ? Number(process.env[k]) : d);

const CONFIG = {
  netSizes: [75, 128, 128, 1],
  iterations: num('TK_ITERS', 40),
  gamesPerIter: num('TK_GAMES', 40),
  turnCap: 60,
  bufferSize: 20000,
  trainStepsPerIter: num('TK_STEPS', 200),
  batchSize: 64,
  lr: 0.01,
  selfPlay: { depth: 0, samples: 2, temperature: 0.6 }, // 빠르고 탐험적
  eval: { depth: 0, samples: 2, temperature: 0, games: num('TK_EVAL', 30) },
  modelPath: './src/solver/model.json',
  seed: num('TK_SEED', 12345),
};

function selfPlayGame(net, rng, cfg) {
  const first = rng() < 0.5 ? 'me' : 'opp';
  let state = createState({ oppHasMitjang: true, turn: first });
  const xs = [];
  let firstDie = true;
  let turns = 0;
  while (!boardFull(state) && turns < cfg.turnCap) {
    xs.push(encode(state));
    state = executeTurn(net, state, rng, cfg.selfPlay, firstDie);
    firstDie = false;
    turns += 1;
  }
  const z = outcomeValue(gameResult(state)); // me 관점 결과
  return { samples: xs.map((x) => ({ x, y: z })), turns };
}

// netA('me' 측) vs netB('opp' 측), 선공 번갈아. netA 승률 반환(무승부 0.5).
function playMatch(netA, netB, rng, cfg) {
  let score = 0;
  for (let g = 0; g < cfg.eval.games; g++) {
    let state = createState({ oppHasMitjang: true, turn: g % 2 === 0 ? 'me' : 'opp' });
    let firstDie = true;
    let turns = 0;
    while (!boardFull(state) && turns < cfg.turnCap) {
      const net = state.turn === 'me' ? netA : netB;
      state = executeTurn(net, state, rng, cfg.eval, firstDie);
      firstDie = false;
      turns += 1;
    }
    const r = gameResult(state);
    score += r === 'me' ? 1 : r === 'draw' ? 0.5 : 0;
  }
  return score / cfg.eval.games;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function main() {
  const cfg = CONFIG;
  const rng = makeRng(cfg.seed);
  let net = createNet(cfg.netSizes, rng);
  let best = deserialize(serialize(net));
  const adam = adamInit(net);
  const buffer = [];

  console.log(`학습 시작: iters=${cfg.iterations} games/iter=${cfg.gamesPerIter} steps/iter=${cfg.trainStepsPerIter} eval=${cfg.eval.games}`);
  for (let iter = 1; iter <= cfg.iterations; iter++) {
    const t0 = Date.now();
    let totTurns = 0;
    for (let g = 0; g < cfg.gamesPerIter; g++) {
      const r = selfPlayGame(net, rng, cfg);
      totTurns += r.turns;
      for (const s of r.samples) buffer.push(s);
    }
    while (buffer.length > cfg.bufferSize) buffer.shift();

    let loss = 0;
    for (let step = 0; step < cfg.trainStepsPerIter; step++) {
      shuffle(buffer, rng);
      loss = trainBatch(net, buffer.slice(0, Math.min(cfg.batchSize, buffer.length)), adam, { lr: cfg.lr });
    }

    const wr = playMatch(net, best, rng, cfg);
    let tag = '유지';
    if (wr >= 0.55) { best = deserialize(serialize(net)); tag = '✅채택'; }
    fs.writeFileSync(cfg.modelPath, serialize(best));

    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[${iter}/${cfg.iterations}] loss=${loss.toFixed(4)} buf=${buffer.length} avgTurns=${(totTurns / cfg.gamesPerIter).toFixed(1)} winVsBest=${(wr * 100).toFixed(0)}% ${tag} (${dt}s)`);
  }
  console.log(`학습 완료 → ${cfg.modelPath} 저장됨`);
}

main();
