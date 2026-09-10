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
    // Вещи, кристаллы и начатое улучшение переживают перерождение:
    // это имущество персонажа, а не забега
    gear: src && src.gear ? { ...src.gear } : {},
    crystals: src && src.crystals !== undefined ? src.crystals : 0,
    upgrade: src && src.upgrade ? { ...src.upgrade } : null,
    stats: {
      taps:    src && src.stats ? (src.stats.taps    || 0) : 0,
      bonuses: src && src.stats ? (src.stats.bonuses || 0) : 0,
      paths:   src && src.stats && src.stats.paths ? src.stats.paths.slice() : [],
      // Пожизненные, через все перерождения. totalEarned обнуляется забегом,
      // потому что на нём считаются очки влияния, а на этих двух потом
      // построится рейтинг — им обнуляться нельзя.
      earnedTotal: src && src.stats ? (src.stats.earnedTotal || 0) : 0,
      spentTotal:  src && src.stats ? (src.stats.spentTotal  || 0) : 0
    }
  };
}

function freshRun(pathId, keep){
  const c = carryOf(keep);
  if (pathId && !c.stats.paths.includes(pathId)) c.stats.paths.push(pathId);
  const state = {
    ...c,
    path: pathId, money: 0, owned: {}, perks: [], totalEarned: 0,
    mods: {},                       // уклады забега, перерождение их стирает
    grown: {},                      // сколько ступеней выросло само
    seen: [],                       // какие развилки уже выпадали в этом забеге
    focus: FOCUS_MAX, ts: Date.now()
  };
  const saved = S; S = state;                     // чтобы metaLevel читал новое состояние
  state.money = startMoneyAt(metaLevel('kapital'));
  S = saved;
  return state;
}
function path(){ return PATHS.find(p => p.id === S.path); }

// Последние ступени лестницы закрыты, пока не куплен «Размах».
// Всё, что показывает или перебирает лестницу, идёт через эту функцию —
// иначе стенд и игра разойдутся в том, что игроку вообще доступно.
function unlockedUpgrades(){
  const size = metaLevel('razmah');
  return path().upgrades.filter(u => u.unlock <= size);
}
/* Купленное и выросшее считаются раздельно.
   Цену поднимает только купленное: иначе после сотни выросших Шестёрок
   следующая стоила бы астрономически, и нижние ступени стало бы
   невозможно докупать руками. На доход работают обе части. */
function bought(id){ return S.owned[id] || 0; }
function grown(id){ return Math.floor((S.grown && S.grown[id]) || 0); }
function owned(id){ return bought(id) + grown(id); }

/* Самопроизводство. Ступень прирастает долей от собственного количества,
   поэтому растёт экспонентой, а не линейно — и это видно за один забег.
   Растёт и то, что выросло само: иначе прирост быстро упёрся бы в потолок. */
function tickProduction(dt){
  if (!S.grown) S.grown = {};
  for (const u of unlockedUpgrades()){
    if (!u.grows) continue;
    const n = owned(u.id);
    if (!n) continue;
    S.grown[u.id] = ((S.grown[u.id] || 0) + n * u.grows * dt);
  }
}

function costMult(){
  return buffMult('cost') * modOf('cost')
       * (perk('postavshik') ? 0.85 : 1)
       * (mastered('business') ? 0.92 : 1);
}
function costOf(u){ return Math.floor(u.cost * Math.pow(u.growth, bought(u.id)) * costMult()); }

/* Цена n штук подряд — сумма геометрической прогрессии, а не n × текущая цена. */
function costOfMany(u, n){
  const start = bought(u.id);
  const room = u.max - start;
  n = Math.min(n, room);
  if (n <= 0) return { n:0, cost:Infinity };
  const g = u.growth;
  const cost = Math.floor(u.cost * Math.pow(g, start) * (Math.pow(g, n) - 1) / (g - 1) * costMult());
  return { n, cost };
}

/* Сколько штук можно позволить прямо сейчас */
function affordable(u){
  const start = bought(u.id);
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
       * buffMult('tap') * chargeMult() * modOf('tap');
}
function perSecond(){
  let sum = 0;
  for (const u of path().upgrades) if (u.type === 'income') sum += u.value * owned(u.id);
  return sum * legacyMult() * achMult() * buffMult('income') * modOf('income');
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
  S.focus = Math.max(0, S.focus - FOCUS_COST * modOf('focus') * (S.focus / FOCUS_MAX));
}
function regenFocus(dt){
  const regen = FOCUS_REGEN * (perk('ergonomika') ? 2 : 1) * (1 + metaLevel('golova') * 0.25);
  S.focus = Math.min(FOCUS_MAX, S.focus + regen * dt);
}


/* ============================================================
   УКЛАДЫ — изменения правил на весь забег.
   Развилка может не просто дать множитель на минуту, а поменять условия
   до конца забега: сильнее тап ценой концентрации, дешевле развитие ценой
   дохода. Это то, ради чего игра называется так, как называется.

   От усилений отличаются двумя вещами: живут до перерождения и лежат
   в состоянии, поэтому переживают перезагрузку страницы. Усиления живут
   в оперативной памяти и считаются секундами.

   Виды: tap, income, focus (расход концентрации), cost (цены развития),
   ability (откат способности), bonus (как часто приходят бонусы).
   ============================================================ */
function modOf(kind){ return (S && S.mods && S.mods[kind]) || 1; }

function setMod(kind, mult){
  if (!S.mods) S.mods = {};
  S.mods[kind] = (S.mods[kind] || 1) * mult;
}

/* Что показать игроку про выбранный уклад. Порядок фиксированный,
   чтобы строка не прыгала от забега к забегу. */
const MOD_NAMES = [
  ['tap',     'тап'],
  ['income',  'доход'],
  ['cost',    'цены'],
  ['focus',   'расход концентрации'],
  ['ability', 'откат способности'],
  ['bonus',   'интервал бонусов']
];

function modList(){
  if (!S || !S.mods) return [];
  return MOD_NAMES
    .filter(([k]) => S.mods[k] && S.mods[k] !== 1)
    .map(([k, name]) => ({ kind: k, name, mult: S.mods[k] }));
}

/* ============================================================
   ПЕРСОНАЖ
   Сила и здоровье собираются из вещей. На доход и тап не влияют:
   проценты уже заняты палатой влияния, а это отдельная ось — для драки.
   ============================================================ */
function powerOf(){
  return GEAR.reduce((n, g) => n + g.power * gearLevel(g.id), 0);
}
function healthOf(){
  return 100 + GEAR.reduce((n, g) => n + g.health * gearLevel(g.id), 0);
}
// Одно число, по которому людей удобно сравнивать. Здоровье под корнем,
// иначе выгодно было бы качать только его: живучесть без силы боёв не выигрывает.
function combatRating(){
  return Math.round(powerOf() * Math.sqrt(healthOf() / 100) * 10) / 10;
}

/* ---------- кристаллы и улучшение вещей ----------
   Улучшение идёт по часам, а не по нажатию: одно за раз, и время растёт
   с уровнем. Считается по меткам времени, поэтому идёт и когда игра закрыта. */

function crystalPrice(n){ return n * CRYSTAL_PRICE; }

function buyCrystals(n){
  const price = crystalPrice(n);
  if (n < 1 || S.legacy < price) return false;
  S.legacy -= price;
  S.crystals += n;
  return true;
}

function upgradeLeft(){
  if (!S || !S.upgrade) return 0;
  return Math.max(0, (S.upgrade.until - Date.now()) / 1000);
}

/* Завершает улучшение, если время вышло. Зовётся и в цикле, и при запуске —
   поэтому таймер честно идёт, пока игра закрыта. */
function tickUpgrade(){
  if (!S || !S.upgrade) return false;
  if (Date.now() < S.upgrade.until) return false;
  S.gear[S.upgrade.id] = S.upgrade.to;
  S.upgrade = null;
  return true;
}

function canUpgrade(id){
  if (!S || S.upgrade) return false;                 // одно улучшение за раз
  const lvl = gearLevel(id);
  if (lvl >= GEAR_MAX) return false;
  return S.crystals >= crystalsFor(lvl + 1);
}

function startUpgrade(id){
  if (!canUpgrade(id)) return false;
  const lvl = gearLevel(id);
  S.crystals -= crystalsFor(lvl + 1);
  S.upgrade = { id, to: lvl + 1, until: Date.now() + secondsFor(lvl + 1) * 1000 };
  return true;
}

/* Через сколько секунд способность будет готова. Живёт здесь, а не в
   обработчике, чтобы стенд считал тот же откат, что и игра. */
function abilityCooldownSec(){
  const a = path().ability;
  if (!a) return Infinity;
  return a.cooldown
       * (perk('avtoritet') ? 0.5 : 1)
       * (1 - metaLevel('svyazi') * 0.10)
       * modOf('ability');
}

function earn(amount){
  S.money += amount; S.totalEarned += amount;
  S.stats.earnedTotal += amount;
}
// Всё, что ушло в развитие: апгрейды и перки. Траты по развилкам сюда не идут —
// это не вложение, а решение по ситуации.
function invest(amount){ S.stats.spentTotal += amount; }
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
// Сколько осталось, словами. Для таймера улучшения.
function dur(sec){
  sec = Math.max(0, Math.ceil(sec));
  if (sec < 60) return sec + 'с';
  const m = Math.floor(sec / 60), s2 = sec % 60;
  if (m < 60) return m + 'м ' + s2 + 'с';
  const h = Math.floor(m / 60);
  return h + 'ч ' + (m % 60) + 'м';
}

// Насколько давно это было, словами. Живёт рядом с fmt и plural,
// потому что зовут его и из ui.js, и из boot.js.
function whenAgo(ts){
  const min = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (min < 1)   return 'только что';
  if (min < 60)  return min + ' ' + plural(min, 'минуту', 'минуты', 'минут') + ' назад';
  const h = Math.round(min / 60);
  if (h < 24)    return h + ' ' + plural(h, 'час', 'часа', 'часов') + ' назад';
  const d = Math.round(h / 24);
  return d + ' ' + plural(d, 'день', 'дня', 'дней') + ' назад';
}
function plural(n, one, few, many){
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

