/* Экономика: настройки баланса, состояние забега, формулы дохода и цен,
   перерождение, формат чисел.
   Порядок подключения задан в index.html и важен: это обычные скрипты,
   а не модули — всё живёт в общей области видимости. */

/* ============================================================
   3. НАСТРОЙКИ
   ============================================================ */
// FLOOR — во что превращается тап на выжатой концентрации. С тратой по остатку
// это цена спешки: при 0.10 четырнадцать тапов в секунду дают всего вдвое больше,
// чем спокойные три с небольшим.
const FOCUS_MAX = 100, FOCUS_COST = 1.2, FOCUS_REGEN = 4, FLOOR = 0.10;
const OFFLINE_CAP = 8 * 3600;

const REBIRTH_DIVISOR = 700;    // делитель в формуле очков влияния
const REBIRTH_POWER   = 0.4;    // степень: чем меньше, тем сильнее душится рост
const REBIRTH_BONUS   = 0.05;   // +5% ко всему за каждое очко
// При минимуме в 1 очко кнопка вылезала на 30-й секунде, хотя перерождаться
// выгодно минут через двадцать. Игра сорок раз подряд предлагала начать сначала
// человеку, который ещё не понял, что такое забег.
// 15 — это 11-я минута при бодрой игре и 20-я при спокойной, то есть примерно
// там же, где покупается первый уникальный апгрейд. Со второго забега очки
// набираются быстрее и порог перестаёт что-либо задерживать, так и задумано.
const REBIRTH_MIN     = 15;     // минимум очков, чтобы кнопка появилась

// Степень 0.4, а не корень. Квадратный корень (0.5) разгонял цифры до взрыва
// к четвёртому забегу, кубический (0.33) душил их до нуля. Это между ними.
function legacyPoints(totalEarned){
  if (totalEarned <= 0) return 0;
  return Math.floor(Math.pow(totalEarned / REBIRTH_DIVISOR, REBIRTH_POWER));
}
function legacyMult(){
  return 1 + metaLevel('vliyanie') * REBIRTH_BONUS;
}

/* ============================================================
   5. СОСТОЯНИЕ
   ============================================================ */
let S = null;

// Всё, что переживает перерождение, лежит здесь. Забег обнуляется, это — нет.
function carryOf(src){
  return {
    legacy:      src && src.legacy      !== undefined ? src.legacy      : 0,
    legacyTotal: src && src.legacyTotal !== undefined ? src.legacyTotal : (src && src.legacy) || 0,
    runs:        src && src.runs        !== undefined ? src.runs        : 0,
    meta:     src && src.meta ? { ...src.meta } : {},
    mastered: src && src.mastered ? src.mastered.slice() : [],
    achieved: src && src.achieved ? src.achieved.slice() : [],
    stats: {
      taps:    src && src.stats ? (src.stats.taps    || 0) : 0,
      bonuses: src && src.stats ? (src.stats.bonuses || 0) : 0,
      paths:   src && src.stats && src.stats.paths ? src.stats.paths.slice() : []
    }
  };
}

function freshRun(pathId, keep){
  const c = carryOf(keep);
  if (pathId && !c.stats.paths.includes(pathId)) c.stats.paths.push(pathId);
  const state = {
    ...c,
    path: pathId, money: 0, owned: {}, perks: [], totalEarned: 0,
    focus: FOCUS_MAX, ts: Date.now()
  };
  const saved = S; S = state;                     // чтобы metaLevel читал новое состояние
  state.money = startMoneyAt(metaLevel('kapital'));
  S = saved;
  return state;
}
function path(){ return PATHS.find(p => p.id === S.path); }
function owned(id){ return S.owned[id] || 0; }
function costMult(){
  return buffMult('cost')
       * (perk('postavshik') ? 0.85 : 1)
       * (mastered('business') ? 0.92 : 1);
}
function costOf(u){ return Math.floor(u.cost * Math.pow(u.growth, owned(u.id)) * costMult()); }

/* Цена n штук подряд — сумма геометрической прогрессии, а не n × текущая цена. */
function costOfMany(u, n){
  const start = owned(u.id);
  const room = u.max - start;
  n = Math.min(n, room);
  if (n <= 0) return { n:0, cost:Infinity };
  const g = u.growth;
  const cost = Math.floor(u.cost * Math.pow(g, start) * (Math.pow(g, n) - 1) / (g - 1) * costMult());
  return { n, cost };
}

/* Сколько штук можно позволить прямо сейчас */
function affordable(u){
  const start = owned(u.id);
  const room = u.max - start;
  if (room <= 0) return 0;
  let n = 0, spent = 0;
  while (n < room && n < 1000){
    const price = Math.floor(u.cost * Math.pow(u.growth, start + n) * costMult());
    if (spent + price > S.money) break;
    spent += price; n++;
  }
  return n;
}

const BULK_MODES = [1, 10, 'max'];
let bulkIndex = 0;
function bulkAmount(u){
  const mode = BULK_MODES[bulkIndex];
  if (mode === 'max') return Math.max(1, affordable(u));
  return mode;
}

function perTap(){
  let flat = 1, mult = 1;
  for (const u of path().upgrades){
    const n = owned(u.id); if (!n) continue;
    if (u.type === 'tap')  flat += u.value * n;
    if (u.type === 'mult') mult *= Math.pow(u.value, n);
  }
  return flat * mult * legacyMult() * achMult()
       * (1 + metaLevel('hvatka') * 0.20)
       * buffMult('tap') * chargeMult();
}
function perSecond(){
  let sum = 0;
  for (const u of path().upgrades) if (u.type === 'income') sum += u.value * owned(u.id);
  return sum * legacyMult() * achMult() * buffMult('income');
}
function focusMult(){
  if (buffActive('nofocus')) return 1;
  return FLOOR + (1 - FLOOR) * (S.focus / FOCUS_MAX);
}

// Трата идёт по остатку, а не поровну. При плоской трате концентрация выбивалась
// в ноль сразу за равновесием (FOCUS_REGEN / FOCUS_COST = 3.33 тапа в секунду),
// и человек, тапающий чуть быстрее, зарабатывал в 4.7 раза меньше. Теперь она
// встаёт на равновесие: быстрее — всегда лучше, но с сильным затуханием.
function spendFocus(){
  if (buffActive('nofocus')) return;
  S.focus = Math.max(0, S.focus - FOCUS_COST * (S.focus / FOCUS_MAX));
}
function regenFocus(dt){
  const regen = FOCUS_REGEN * (perk('ergonomika') ? 2 : 1) * (1 + metaLevel('golova') * 0.25);
  S.focus = Math.min(FOCUS_MAX, S.focus + regen * dt);
}

function earn(amount){ S.money += amount; S.totalEarned += amount; }
function spend(amount){ const c = Math.min(amount, S.money); S.money -= c; return c; }
// Очки за текущий забег. Потраченное в магазине здесь ни при чём:
// totalEarned обнуляется перерождением, так что двойной выдачи не будет.
function pendingPoints(){ return legacyPoints(S.totalEarned); }

/* ============================================================
   6. ФОРМАТ ЧИСЕЛ
   ============================================================ */
const UNITS = ['', 'K', 'M', 'B', 'T', 'aa', 'ab', 'ac'];
function fmt(n){
  if (n < 1000) return (n < 10 && n % 1 !== 0) ? n.toFixed(1) : Math.floor(n).toString();
  let i = 0;
  while (n >= 1000 && i < UNITS.length - 1){ n /= 1000; i++; }
  return (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.floor(n)) + UNITS[i];
}
function plural(n, one, few, many){
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

