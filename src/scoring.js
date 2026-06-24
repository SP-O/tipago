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

export function gameResult(state) {
  let me = 0;
  let opp = 0;
  for (let i = 0; i < 3; i++) {
    const r = lineResult(state.me.lines[i], state.opp.lines[i]);
    if (r === 'me') me++;
    else if (r === 'opp') opp++;
  }
  return me > opp ? 'me' : opp > me ? 'opp' : 'draw';
}

export function outcomeValue(result) {
  return result === 'me' ? 1 : result === 'draw' ? 0.5 : 0;
}
