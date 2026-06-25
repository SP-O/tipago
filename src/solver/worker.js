import { recommend } from './recommend.js';
import { nnRecommend } from './nn-search.js';
import { makeRng } from './evaluate.js';

// 학습된 신경망(model.json)이 있으면 그걸로 추천, 없으면 기존 솔버로 폴백.
let net = null;
const modelReady = fetch(new URL('./model.json', import.meta.url))
  .then((r) => (r.ok ? r.json() : null))
  .then((m) => { net = m && m.layers ? m : null; })
  .catch(() => { net = null; });

self.onmessage = async (e) => {
  const { id, state, die, opts } = e.data;
  try {
    await modelReady;
    const o = opts || {};
    let result;
    if (net) {
      result = nnRecommend(net, state, die, {
        isBonus: o.isBonus,
        depth: o.depth ?? 1,
        samples: o.samples ?? 6,
        rng: makeRng(o.seed ?? 1234567),
      });
      result.engine = 'nn';
    } else {
      result = recommend(state, die, o);
      result.engine = 'classic';
    }
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
