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

// 강함 손잡이(환경변수): DEPTH가 강함의 핵심(깊을수록 강하지만 느림)
const HIDDEN = num('TK_HIDDEN', 128);     // 신경망 은닉층 크기(용량)
const DEPTH = num('TK_DEPTH', 0);         // self-play/평가 탐색 깊이(턴). 0=빠름, 1=강함, 2=매우 느림
const SAMPLES = num('TK_SAMPLES', 2);     // 주사위 샘플 수. 6 이상=정확한 기댓값
const TEMP = num('TK_TEMP', 0.8);         // self-play 시작 탐험 온도
const TEMP_END = num('TK_TEMP_END', 0.1); // self-play 종료 탐험 온도(점감)
const PATIENCE = num('TK_PATIENCE', 60);  // 개선 없이 이 횟수 지나면 조기 종료(0=비활성)
const RESUME = num('TK_RESUME', 0);       // 1이면 기존 model.json에서 이어 학습

const CONFIG = {
  netSizes: [75, HIDDEN, HIDDEN, 1],
  iterations: num('TK_ITERS', 40),
  gamesPerIter: num('TK_GAMES', 40),
  turnCap: 60,
  bufferSize: num('TK_BUFFER', 50000),
  trainStepsPerIter: num('TK_STEPS', 200),
  batchSize: 64,
  lr: 0.01,
  tempStart: TEMP,
  tempEnd: TEMP_END,
  patience: PATIENCE,
  resume: RESUME,
  selfPlay: { depth: DEPTH, samples: SAMPLES, temperature: TEMP },
  eval: { depth: DEPTH, samples: SAMPLES, temperature: 0, games: num('TK_EVAL', 30) },
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

  // 이어 학습: 기존 model.json 로드(구조 일치 시)
  if (cfg.resume && fs.existsSync(cfg.modelPath)) {
    try {
      const loaded = deserialize(fs.readFileSync(cfg.modelPath, 'utf8'));
      if (JSON.stringify(loaded.sizes) === JSON.stringify(cfg.netSizes)) {
        net = loaded;
        console.log('이어 학습: 기존 model.json 로드됨');
      } else {
        console.log('경고: 기존 model.json 구조 불일치 → 새로 시작');
      }
    } catch {
      console.log('경고: model.json 로드 실패 → 새로 시작');
    }
  }

  let best = deserialize(serialize(net));
  const adam = adamInit(net);
  const buffer = [];
  let noImprove = 0;

  console.log(`학습 시작: iters=${cfg.iterations} games/iter=${cfg.gamesPerIter} steps/iter=${cfg.trainStepsPerIter} eval=${cfg.eval.games} | hidden=${HIDDEN} depth=${DEPTH} samples=${SAMPLES} temp=${cfg.tempStart}→${cfg.tempEnd} patience=${cfg.patience} resume=${cfg.resume}`);
  for (let iter = 1; iter <= cfg.iterations; iter++) {
    const t0 = Date.now();
    // 탐험 온도 점감(초반 탐험 → 후반 정밀)
    const frac = cfg.iterations > 1 ? (iter - 1) / (cfg.iterations - 1) : 1;
    cfg.selfPlay.temperature = cfg.tempEnd + (cfg.tempStart - cfg.tempEnd) * (1 - frac);

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
    if (wr >= 0.55) { best = deserialize(serialize(net)); tag = '✅채택'; noImprove = 0; }
    else noImprove += 1;
    fs.writeFileSync(cfg.modelPath, serialize(best));

    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[${iter}/${cfg.iterations}] loss=${loss.toFixed(4)} buf=${buffer.length} avgTurns=${(totTurns / cfg.gamesPerIter).toFixed(1)} temp=${cfg.selfPlay.temperature.toFixed(2)} winVsBest=${(wr * 100).toFixed(0)}% ${tag} (${dt}s)`);

    if (cfg.patience > 0 && noImprove >= cfg.patience) {
      console.log(`조기 종료: ${cfg.patience}회 연속 개선 없음(수렴) → 중단`);
      break;
    }
  }
  console.log(`학습 완료 → ${cfg.modelPath} 저장됨`);
}

main();
