// src/solver/advice.js — 추천 결과 해석 헬퍼(순수, 무거운 의존성 없음 → 메인 스레드에서 직접 import).
// options 는 winProb 내림차순 정렬된 추천 후보 배열.

// 1등이 2등보다 이 이하로만 앞서면 "근소차" → 추천은 참고만 하고 직감에 맡기도록 안내.
export const CLOSE_MARGIN = 0.07;

export function topLead(options) {
  if (!options || options.length < 2) return Infinity; // 비교 대상 없음 = 1등이 명확
  return options[0].winProb - options[1].winProb;
}

export function isCloseCall(options, margin = CLOSE_MARGIN) {
  return topLead(options) <= margin;
}
