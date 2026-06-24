import { recommend } from './recommend.js';

self.onmessage = (e) => {
  const { id, state, die, opts } = e.data;
  try {
    const result = recommend(state, die, opts || {});
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
