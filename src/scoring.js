export function lineSum(line) {
  const counts = {};
  for (const d of line) counts[d.value] = (counts[d.value] || 0) + 1;
  let sum = 0;
  for (const v in counts) {
    const c = counts[v];
    const val = Number(v);
    sum += c === 1 ? val : c === 2 ? 3 * val : 5 * val;
  }
  return sum;
}

export function lineResult(myLine, oppLine) {
  const a = lineSum(myLine);
  const b = lineSum(oppLine);
  return a > b ? 'me' : b > a ? 'opp' : 'draw';
}

export function boardTotal(board) {
  return board.lines.reduce((sum, line) => sum + lineSum(line), 0);
}

export function gameResult(state) {
  let me = 0;
  let opp = 0;
  for (let i = 0; i < 3; i++) {
    const r = lineResult(state.me.lines[i], state.opp.lines[i]);
    if (r === 'me') me++;
    else if (r === 'opp') opp++;
  }
  if (me > opp) return 'me';
  if (opp > me) return 'opp';
  // 라인 승수 동률 → 세 필드 총합이 높은 쪽 승, 총합도 같으면 무승부
  const myTotal = boardTotal(state.me);
  const oppTotal = boardTotal(state.opp);
  if (myTotal > oppTotal) return 'me';
  if (oppTotal > myTotal) return 'opp';
  return 'draw';
}

export function outcomeValue(result) {
  return result === 'me' ? 1 : result === 'draw' ? 0.5 : 0;
}
