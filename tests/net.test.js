import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/solver/evaluate.js';
import { createNet, forward, predict } from '../src/solver/net.js';
import { backwardValue, mseLoss, adamInit, trainBatch } from '../src/solver/nn-train.js';

test('forward: 출력은 0~1 (sigmoid 가치)', () => {
  const net = createNet([3, 4, 1], makeRng(1));
  const v = predict(net, [0.5, -0.2, 0.9]);
  assert.ok(v > 0 && v < 1);
});

test('그래디언트 체크: 해석적 ≈ 수치적 (오차 < 1e-4)', () => {
  const net = createNet([3, 4, 1], makeRng(7));
  const x = [0.5, -0.2, 0.9];
  const target = 0.7;
  const grads = backwardValue(net, forward(net, x), target);
  const eps = 1e-5;
  let maxErr = 0;
  const lossAt = () => mseLoss(forward(net, x).value, target);
  for (let l = 0; l < net.layers.length; l++) {
    const layer = net.layers[l];
    for (let j = 0; j < layer.W.length; j++) {
      for (let i = 0; i < layer.W[j].length; i++) {
        const orig = layer.W[j][i];
        layer.W[j][i] = orig + eps; const lp = lossAt();
        layer.W[j][i] = orig - eps; const lm = lossAt();
        layer.W[j][i] = orig;
        maxErr = Math.max(maxErr, Math.abs((lp - lm) / (2 * eps) - grads[l].dW[j][i]));
      }
    }
    for (let j = 0; j < layer.b.length; j++) {
      const orig = layer.b[j];
      layer.b[j] = orig + eps; const lp = lossAt();
      layer.b[j] = orig - eps; const lm = lossAt();
      layer.b[j] = orig;
      maxErr = Math.max(maxErr, Math.abs((lp - lm) / (2 * eps) - grads[l].db[j]));
    }
  }
  assert.ok(maxErr < 1e-4, `gradient check maxErr=${maxErr}`);
});

test('과적합: 작은 데이터셋 손실이 0에 수렴(학습 기계가 옳음)', () => {
  const rng = makeRng(3);
  const net = createNet([3, 8, 1], rng);
  const samples = [];
  for (let k = 0; k < 4; k++) {
    samples.push({ x: [rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1], y: 0.1 + 0.8 * rng() });
  }
  const adam = adamInit(net);
  let loss = 1;
  for (let step = 0; step < 4000; step++) loss = trainBatch(net, samples, adam, { lr: 0.03 });
  assert.ok(loss < 1e-3, `final loss=${loss}`);
});
