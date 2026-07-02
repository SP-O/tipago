// 3·5 판별기 회귀: 저해상도에서 3과 5는 점 배치가 겹쳐 전역 SSD 마진이 붕괴(6% 수준)→
// 프레임마다 5↔3로 뒤집혀 계산이 깜빡였다. 템플릿 차이영역(5에만 있는 모서리 점)만 재비교해
// 접전 5를 확신 있게 5로 굳힌다. 이 테스트는 그 확신(conf) 회복을 잠근다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadPng } from './png.mjs';
import { recognizeFrame } from '../../src/vision/recognize.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../vision-fixtures');
const R = (mlx, r1y) => ({ x: mlx - 96, y: r1y - 72, w: 979, h: 434 });

// area-average 리샘플(RGBA) — scale.test.js와 동일. s<1 = 저해상도 시뮬.
function resample(frame, s) {
  const sw = frame.width, sh = frame.height, dw = Math.round(sw*s), dh = Math.round(sh*s);
  const out = new Uint8ClampedArray(dw*dh*4);
  for (let dy=0; dy<dh; dy++) for (let dx=0; dx<dw; dx++) {
    const sx0=Math.floor(dx/s), sx1=Math.max(sx0+1, Math.min(sw, Math.floor((dx+1)/s)));
    const sy0=Math.floor(dy/s), sy1=Math.max(sy0+1, Math.min(sh, Math.floor((dy+1)/s)));
    let r=0,g=0,b=0,a=0,n=0;
    for (let sy=sy0; sy<sy1; sy++) for (let sx=sx0; sx<sx1; sx++){ const i=(sy*sw+sx)*4; r+=frame.data[i];g+=frame.data[i+1];b+=frame.data[i+2];a+=frame.data[i+3];n++; }
    const j=(dy*dw+dx)*4; out[j]=r/n; out[j+1]=g/n; out[j+2]=b/n; out[j+3]=a/n;
  }
  return { data: out, width: dw, height: dh };
}
const scaleRect = (r,s) => ({ x:Math.round(r.x*s), y:Math.round(r.y*s), w:Math.round(r.w*s), h:Math.round(r.h*s) });

const skip = !existsSync(join(FIX, '12-live.png')) && 'vision-fixtures 없음(로컬 전용)';

test('저해상도 접전 5를 판별기로 확신있게 5 (12-live me L1c1 @0.75)', { skip }, () => {
  const frame = resample(loadPng(join(FIX, '12-live.png')), 0.75);
  const r = recognizeFrame(frame, scaleRect(R(892,626), 0.75));
  const cell = r.cells.me[1][1]; // 정답 5, 전역 마진 ~6%(깜빡임)
  assert.equal(cell.value, 5, '값은 5여야');
  assert.ok(cell.conf >= 0.15, `conf ${(+cell.conf).toFixed(3)} 이 0.15 이상이어야(깜빡임 방지). 판별기 전엔 ~0.06`);
});

test('판별기는 접전이 아닌 5(또렷)의 값을 바꾸지 않음 (13-live me L1c0 @0.75)', { skip }, () => {
  const frame = resample(loadPng(join(FIX, '13-live.png')), 0.75);
  const r = recognizeFrame(frame, scaleRect(R(890,616), 0.75));
  assert.equal(r.cells.me[1][0].value, 5); // 원래 마진 큰 5 — 회귀 없음
});
