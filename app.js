import { lineSum } from './src/scoring.js';

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
    const st = reactive({
      me: [[], [], []],   // 각 칸: {value, shield} 또는 빈 슬롯은 배열 길이로 표현 X → 고정 길이 3, null 사용
      opp: [[], [], []],
      // 고정 3칸 슬롯 모델: 각 라인을 [slot,slot,slot]로 두고 빈칸은 null
    });
    // 슬롯 모델을 고정길이 3 + null 로 초기화
    for (const side of ['me', 'opp']) st[side] = [[null, null, null], [null, null, null], [null, null, null]];

    const die = ref(null);
    const ui = reactive({
      selected: null,       // {side, li, si}
      bonusMode: false,
      myMitjang: true,
      oppMitjang: false,
      solving: false,
      result: null,
    });

    // ---- 슬롯 조작 ----
    function selectSlot(side, li, si) {
      ui.selected = { side, li, si };
    }
    function setSlotValue(n) {
      if (!ui.selected) return;
      const { side, li, si } = ui.selected;
      const cur = st[side][li][si];
      st[side][li][si] = { value: n, shield: cur ? cur.shield : false };
    }
    function toggleSlotShield() {
      if (!ui.selected) return;
      const { side, li, si } = ui.selected;
      const cur = st[side][li][si];
      if (!cur) return;
      st[side][li][si] = { value: cur.value, shield: !cur.shield };
    }
    function clearSlot() {
      if (!ui.selected) return;
      const { side, li, si } = ui.selected;
      st[side][li][si] = null;
    }

    // ---- 표시 헬퍼 ----
    function lineArr(side, li) {
      return st[side][li].filter((d) => d !== null).map((d) => ({ value: d.value, shield: d.shield }));
    }
    function sumOf(side, li) { return lineSum(lineArr(side, li)); }
    function slotText(side, li, si) {
      const d = st[side][li][si];
      return d ? d.value : '·';
    }
    function slotClass(side, li, si) {
      const d = st[side][li][si];
      const sel = ui.selected && ui.selected.side === side && ui.selected.li === li && ui.selected.si === si;
      return { filled: !!d, shield: d && d.shield, selected: sel };
    }
    function recHighlight(side, li) {
      if (!ui.result || !ui.result.best) return '0';
      const t = ui.result.best.target;
      return t.side === side && t.lineIndex === li ? '1' : '0';
    }
    const selectedLabel = computed(() => {
      if (!ui.selected) return '';
      const { side, li, si } = ui.selected;
      return `${side === 'me' ? '내' : '상대'} 라인 ${li + 1} · ${si + 1}번칸`;
    });

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
      try {
        const state = buildEngineState();
        const result = await solveAsync({ state, die: die.value, opts: { isBonus: ui.bonusMode, seed: 1234567 } });
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
      selectSlot, setSlotValue, toggleSlotShield, clearSlot,
      sumOf, slotText, slotClass, recHighlight, selectedLabel,
      solve, pct, targetLabel, winColor,
    };
  },
}).mount('#app');
