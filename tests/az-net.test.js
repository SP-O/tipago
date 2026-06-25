import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/solver/evaluate.js';
import {
  createAzNet, azForward, azBackward, azLoss, azApplyGrads, softmaxMasked,
} from '../src/solver/az-net.js';

test('AZ forward: value 0~1, policyLogits 길이=numActions', () => {
  const net = createAzNet([3, 4], 3, makeRng(1));
  const fwd = azForward(net, [0.5, -0.2, 0.9]);
  assert.ok(fwd.value > 0 && fwd.value < 1);
  assert.equal(fwd.policyLogits.length, 3);
});

test('AZ 그래디언트 체크: 결합손실(가치MSE+정책CE) 해석적≈수치적', () => {
  const net = createAzNet([3, 4], 3, makeRng(7));
  const x = [0.5, -0.2, 0.9];
  const vT = 0.7;
  const mask = [1, 1, 0];
  const piT = [0.6, 0.4, 0];
  const grads = azBackward(net, azForward(net, x), vT, piT, mask);
  const eps = 1e-5;
  const lossAt = () => azLoss(azForward(net, x), vT, piT, mask);
  let maxErr = 0;
  const groups = net.body.map((layer, l) => ({ layer, g: grads.body[l] }));
  groups.push({ layer: net.valueHead, g: grads.valueHead });
  groups.push({ layer: net.policyHead, g: grads.policyHead });
  for (const { layer, g } of groups) {
    for (let j = 0; j < layer.W.length; j++) {
      for (let i = 0; i < layer.W[j].length; i++) {
        const o = layer.W[j][i];
        layer.W[j][i] = o + eps; const lp = lossAt();
        layer.W[j][i] = o - eps; const lm = lossAt();
        layer.W[j][i] = o;
        maxErr = Math.max(maxErr, Math.abs((lp - lm) / (2 * eps) - g.dW[j][i]));
      }
      const ob = layer.b[j];
      layer.b[j] = ob + eps; const lpb = lossAt();
      layer.b[j] = ob - eps; const lmb = lossAt();
      layer.b[j] = ob;
      maxErr = Math.max(maxErr, Math.abs((lpb - lmb) / (2 * eps) - g.db[j]));
    }
  }
  assert.ok(maxErr < 1e-4, `gradient check maxErr=${maxErr}`);
});

test('AZ 과적합: 고정 타깃 학습(value→vT, policy→piT)', () => {
  const net = createAzNet([3, 8], 3, makeRng(3));
  const x = [0.3, -0.5, 0.8];
  const vT = 0.8;
  const mask = [1, 1, 1];
  const piT = [0.2, 0.5, 0.3];
  for (let s = 0; s < 3000; s++) {
    azApplyGrads(net, azBackward(net, azForward(net, x), vT, piT, mask), 0.1);
  }
  const fwd = azForward(net, x);
  assert.ok(Math.abs(fwd.value - vT) < 0.02, `value=${fwd.value}`);
  const p = softmaxMasked(fwd.policyLogits, mask);
  for (let a = 0; a < 3; a++) assert.ok(Math.abs(p[a] - piT[a]) < 0.03, `p[${a}]=${p[a]}`);
});
