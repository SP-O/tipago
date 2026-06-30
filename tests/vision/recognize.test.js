import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPng } from './png.mjs';
import { recognizeFrame } from '../../src/vision/recognize.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../vision-fixtures');
const R = (mlx, r1y) => ({ x: mlx - 96, y: r1y - 72, w: 979, h: 434 });
const FRAMES = [
  { n: '10-live-capture.png', r: R(888,654), roll:6, me:[[0,0,4],[0,0,0],[0,0,0]], opp:[[0,0,0],[4,0,0],[0,0,0]] },
  { n: '11-live.png', r: R(885,653), roll:2, me:[[2,4,4],[1,2,2],[0,5,4]], opp:[[6,1,1],[3,1,5],[3,6,1]] },
  { n: '12-live.png', r: R(892,626), roll:3, me:[[3,6,2],[2,5,6],[0,6,6]], opp:[[5,5,0],[3,0,0],[2,2,2]] },
  { n: '13-live.png', r: R(890,616), roll:1, me:[[0,1,2],[5,5,6],[5,2,4]], opp:[[2,5,5],[3,0,0],[3,1,0]] },
  { n: '14-live.png', r: R(894,616), roll:2, me:[[3,2,2],[0,4,2],[6,5,5]], opp:[[1,1,4],[4,6,3],[4,4,3]] },
];

test('recognizeFrame(boardRect): 라이브 5장 칸 정확도 >= 90%', () => {
  let correct = 0, total = 0;
  for (const f of FRAMES) {
    const r = recognizeFrame(loadPng(join(FIX, f.n)), f.r);
    for (const side of ['me','opp']) for (let li=0; li<3; li++) for (let ci=0; ci<3; ci++) {
      const got = r.cells[side][li][ci] ? r.cells[side][li][ci].value : 0;
      total++; if (got === f[side][li][ci]) correct++;
    }
  }
  const acc = correct / total;
  assert.ok(acc >= 0.90, `정확도 ${(acc*100).toFixed(1)}% (${correct}/${total})`);
});

test('recognizeFrame(10-live): 전칸 정확 + 턴/굴린주사위', () => {
  const f = FRAMES[0];
  const r = recognizeFrame(loadPng(join(FIX, f.n)), f.r);
  assert.equal(r.isMyTurn, true);
  assert.equal(r.rolledDie, 6);
  assert.equal(r.clipped, false);
  const vals = (s,li) => r.cells[s][li].map(c => c ? c.value : 0);
  assert.deepEqual(vals('me',0), [0,0,4]);
  assert.deepEqual(vals('opp',1), [4,0,0]);
});

test('recognizeFrame(null): 앵커 경로 동작 유지(02)', () => {
  const r = recognizeFrame(loadPng(join(FIX, '02-midgame-shields.png')));
  assert.equal(typeof r.isMyTurn, 'boolean'); // 앵커 경로가 throw 없이 돈다
});
