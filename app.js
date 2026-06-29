import { lineSum } from './src/scoring.js';
import { cellToDieIndex, nextFillCell } from './src/ui-layout.js';

const { createApp, ref, reactive, computed, toRefs } = window.Vue;

const worker = new Worker(new URL('./src/solver/worker.js', import.meta.url), { type: 'module' });
let msgId = 0;
const pending = new Map();
worker.onmessage = (e) => {
  const { id, result, error } = e.data;
  const cb = pending.get(id);
  if (!cb) return;
  pending.delete(id);
  if (error) cb.reject(new Error(error));
  else cb.resolve(result);
};
function solveAsync(payload) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, ...payload });
  });
}

createApp({
  setup() {
    // 각 라인은 packed 배열(빈 칸 없음): [{value, shield}, ...] (0 = 먼저 놓인 주사위)
    const emptyBoard = () => [[], [], []];
    const st = reactive({ me: emptyBoard(), opp: emptyBoard() });
    const isBoardEmpty = () => st.me.every((l) => l.length === 0) && st.opp.every((l) => l.length === 0);

    const die = ref(null);
    const ui = reactive({
      selected: null,    // { side, li, dieIndex } 기존 편집 | { side, li, isNew:true } 추가
      bonusMode: false,
      myMitjang: true,
      oppMitjang: false,
      solving: false,
      result: null,
      solvedDie: null,   // 추천 계산 시점의 굴린 주사위(알까기 적용용)
      precise: false,    // 정밀 모드(느림·더 최적)
      realAI: false,     // 실제 AI 상대 모드(실전 AI 성향 반영)
      nextShield: false, // 다음에 놓는 주사위를 실드로(알까기 보너스용, 1회 후 자동 해제)
    });

    const history = reactive([]); // 보드 스냅샷 스택(되돌리기)

    // ---- 히스토리 ----
    function snapshot() {
      return {
        me: st.me.map((l) => l.map((d) => ({ value: d.value, shield: d.shield }))),
        opp: st.opp.map((l) => l.map((d) => ({ value: d.value, shield: d.shield }))),
      };
    }
    function pushHistory() {
      history.push(snapshot());
      if (history.length > 50) history.shift();
      ui.result = null; // 보드가 바뀌면 이전 추천은 무효
    }
    const canUndo = computed(() => history.length > 0);
    function undo() {
      if (history.length === 0) return;
      const snap = history.pop();
      st.me = snap.me;
      st.opp = snap.opp;
      ui.selected = null;
      ui.result = null;
    }

    // ---- 슬롯 조작 ----
    function selectSlot(side, li, cell) {
      const len = st[side][li].length;
      const di = cellToDieIndex(side, len, cell);
      if (di >= 0) {
        ui.selected = { side, li, dieIndex: di };
      } else if (len < 3) {
        ui.selected = { side, li, isNew: true };
      } else {
        ui.selected = null;
      }
    }
    function setSlotValue(n) {
      if (!ui.selected) return;
      const { side, li } = ui.selected;
      pushHistory();
      if (ui.selected.isNew) {
        if (st[side][li].length < 3) {
          // 선공 첫 주사위(빈 보드)·알까기 보너스(nextShield)·보너스 주사위 모드 → 자동 실드
          const shield = isBoardEmpty() || ui.nextShield || ui.bonusMode;
          st[side][li].push({ value: n, shield });
          if (ui.nextShield) ui.nextShield = false; // 한 개 적용 후 자동 해제
          if (ui.bonusMode) ui.bonusMode = false;   // 보너스 주사위 놓은 뒤 일반 모드 복귀
        }
      } else {
        st[side][li][ui.selected.dieIndex].value = n;
      }
      ui.selected = null; // 숫자 입력 후 선택 해제(상호작용 최소화, alt+tab 친화)
    }
    function toggleSlotShield() {
      if (!ui.selected || ui.selected.isNew) return;
      const { side, li, dieIndex } = ui.selected;
      const d = st[side][li][dieIndex];
      if (!d) return;
      pushHistory();
      d.shield = !d.shield;
    }
    function clearSlot() {
      if (!ui.selected) return;
      if (ui.selected.isNew) { ui.selected = null; return; }
      const { side, li, dieIndex } = ui.selected;
      pushHistory();
      st[side][li].splice(dieIndex, 1); // packed → 자동으로 당겨짐
      ui.selected = null;
    }
    function clearSlotAt(side, li, cell) {
      // 우클릭: 해당 칸의 주사위를 바로 제거(빈 칸이면 무시)
      const di = cellToDieIndex(side, st[side][li].length, cell);
      if (di < 0) return;
      pushHistory();
      st[side][li].splice(di, 1);
      ui.selected = null;
    }
    function clearAll() {
      pushHistory();
      st.me = emptyBoard();
      st.opp = emptyBoard();
      ui.selected = null;
    }

    // ---- 표시 헬퍼 ----
    function lineArr(side, li) {
      return st[side][li].map((d) => ({ value: d.value, shield: d.shield }));
    }
    function sumOf(side, li) { return lineSum(st[side][li]); }
    function sumClass(side, li) {
      const a = lineSum(st.me[li]);
      const b = lineSum(st.opp[li]);
      const mine = side === 'me' ? a : b;
      const other = side === 'me' ? b : a;
      return mine > other ? 'win' : mine < other ? 'lose' : 'tie';
    }
    function slotText(side, li, cell) {
      const di = cellToDieIndex(side, st[side][li].length, cell);
      return di >= 0 ? st[side][li][di].value : '·';
    }
    function slotClass(side, li, cell) {
      const len = st[side][li].length;
      const di = cellToDieIndex(side, len, cell);
      const filled = di >= 0;
      let selected = false;
      const sel = ui.selected;
      if (sel && sel.side === side && sel.li === li) {
        if (sel.isNew) selected = cell === nextFillCell(side, len);
        else selected = di === sel.dieIndex;
      }
      return {
        filled,
        shield: filled && st[side][li][di].shield,
        selected,
      };
    }
    function rowRec(li) {
      return !!(ui.result && ui.result.best && ui.result.best.target.lineIndex === li);
    }
    const selectedLabel = computed(() => {
      const sel = ui.selected;
      if (!sel) return '';
      const sideKo = sel.side === 'me' ? '내' : '상대';
      return sel.isNew
        ? `${sideKo} 라인 ${sel.li + 1} (새 주사위)`
        : `${sideKo} 라인 ${sel.li + 1}`;
    });
    const selectedIsNew = computed(() => !!(ui.selected && ui.selected.isNew));

    // ---- 알까기 적용 ----
    const canApplyAlkkagi = computed(() => !!(ui.result && ui.result.best && ui.result.best.alkkagi));
    const alkkagiLabel = computed(() => {
      if (!canApplyAlkkagi.value) return '';
      const L = ui.result.best.target.lineIndex + 1;
      return `⚡ 알까기 적용 (상대 라인 ${L}에서 ${ui.solvedDie} 제거)`;
    });
    function applyAlkkagi() {
      if (!canApplyAlkkagi.value) return;
      const L = ui.result.best.target.lineIndex;
      const v = ui.solvedDie;
      pushHistory(); // ui.result는 여기서 무효화됨
      st.opp[L] = st.opp[L].filter((d) => !(d.value === v && !d.shield));
      ui.selected = null;
      ui.nextShield = true; // 알까기 보너스 주사위는 실드 → 다음에 놓는 주사위 자동 실드
      ui.bonusMode = true;  // 다음 계산은 보너스 주사위 배치(양쪽 후보) 추천
    }

    // ---- 상태 → 엔진 state 변환 ----
    function buildEngineState() {
      const toBoard = (side, hasMitjang) => ({
        lines: [0, 1, 2].map((li) => lineArr(side, li)),
        hasMitjang,
      });
      return {
        me: toBoard('me', ui.myMitjang),
        opp: toBoard('opp', ui.oppMitjang),
        turn: 'me',
      };
    }

    // ---- 솔브 ----
    async function solve() {
      if (!die.value) return;
      ui.solving = true;
      ui.result = null;
      ui.solvedDie = die.value;
      try {
        const state = buildEngineState();
        const result = await solveAsync({ state, die: die.value, opts: { isBonus: ui.bonusMode, seed: 1234567, precise: ui.precise, realAI: ui.realAI } });
        ui.result = result;
      } catch (err) {
        ui.result = { options: [], best: null, mitjang: null, _error: String(err.message) };
      } finally {
        ui.solving = false;
      }
    }

    // ---- 포맷 ----
    function pct(p) { return `${Math.round(p * 100)}%`; }
    function targetLabel(t) {
      return `${t.side === 'me' ? '내' : '상대'} 라인 ${t.lineIndex + 1}`;
    }
    function winColor(p) {
      if (p >= 0.6) return { color: 'var(--green)' };
      if (p <= 0.4) return { color: 'var(--red)' };
      return { color: 'var(--text)' };
    }

    return {
      ...toRefs(st),
      die,
      ...toRefs(ui),
      canUndo, undo, clearAll,
      selectSlot, setSlotValue, toggleSlotShield, clearSlot, clearSlotAt,
      sumOf, sumClass, slotText, slotClass, rowRec, selectedLabel, selectedIsNew,
      canApplyAlkkagi, alkkagiLabel, applyAlkkagi,
      solve, pct, targetLabel, winColor,
    };
  },
}).mount('#app');
