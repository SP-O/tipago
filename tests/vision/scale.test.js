// 해상도 무관 회귀: 라이브 픽스처(2560x1440)를 축소/확대해 다른 해상도를 시뮬레이션.
// 예전엔 절대 픽셀 상수(블롭 55~110px, 템플릿 창 70px) 때문에 기준 배율 밖에선 인식이 무너졌음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
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

// area-average 리샘플(RGBA). s<1 축소(저해상도), s>1 확대(고해상도) 시뮬.
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

const skip = !existsSync(join(FIX, FRAMES[0].n)) && 'vision-fixtures 없음(로컬 전용)';

test('recognizeFrame: 저/고해상도 시뮬에서 칸 인식 유지(스케일 무관)', { skip }, () => {
  for (const s of [0.656 /*~1680*/, 0.75 /*~1920x1080*/, 1.5 /*3840x2160*/]) {
    let correct = 0, total = 0, rollOk = 0;
    for (const f of FRAMES) {
      const r = recognizeFrame(resample(loadPng(join(FIX, f.n)), s), scaleRect(f.r, s));
      for (const side of ['me','opp']) for (let li=0; li<3; li++) for (let ci=0; ci<3; ci++) {
        const got = r.cells[side][li][ci] ? r.cells[side][li][ci].value : 0;
        total++; if (got === f[side][li][ci]) correct++;
      }
      if (r.rolledDie === f.roll) rollOk++;
    }
    const acc = correct / total;
    assert.ok(acc >= 0.9, `scale ${s}: 칸 ${(acc*100).toFixed(1)}% (${correct}/${total})`);
    assert.ok(rollOk >= 4, `scale ${s}: 굴린주사위 ${rollOk}/5`);
  }
});
