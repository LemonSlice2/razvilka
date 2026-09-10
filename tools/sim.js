/* Стенд для баланса.

   Грузит настоящие js/content.js, js/economy.js и js/systems.js, подменяя
   браузер заглушками. Логика забега берётся из игры: концентрация считается
   теми же spendFocus() и regenFocus(), расписание бонусов — тем же
   bonusDelaySec(), откат способности — тем же abilityCooldownSec().
   Поэтому стенд не может разойтись с игрой в этих местах.

   ВРЕМЯ. Игра всюду берёт Date.now(). Стенд проигрывает двадцать минут за
   доли секунды, поэтому у него свои часы: Date.now() внутри возвращает
   виртуальное время, которое двигает сам цикл. Без этого усиления никогда
   не истекали бы, а откат способности не заканчивался.

   ЧТО СТЕНД ЗНАЕТ: лестницу, перки, концентрацию, престиж, палату влияния,
   бонусы, способности, развилки и уклады.
   ЧЕГО НЕ ЗНАЕТ: драку с другими игроками (она на сервере) и вещи (они на
   доход не влияют).

   Запуск:  node tools/report.js                                            */

const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');

const BROWSER = `
/* ---------- виртуальные часы ---------- */
var __clock = 1700000000000;
const __RealDate = Date;
function __FakeDate(...a){ return new __RealDate(...a); }
__FakeDate.now = () => __clock;
__FakeDate.prototype = __RealDate.prototype;
var Date = __FakeDate;

const el = () => ({ style:{}, classList:{ add(){}, remove(){}, toggle(){}, contains(){return false} },
                    remove(){}, appendChild(){}, textContent:'', innerHTML:'',
                    getBoundingClientRect:()=>({left:0,top:0}), querySelector:()=>el() });
const __store = {};
var localStorage = { setItem:(k,v)=>{__store[k]=v}, getItem:k=>(k in __store?__store[k]:null),
                     removeItem:k=>{delete __store[k]} };
var window = {}, navigator = {};
var document = { getElementById:()=>null, createElement:()=>el(), querySelector:()=>el(),
                 querySelectorAll:()=>[], body:{ appendChild(){} },
                 documentElement:{ style:{ setProperty(){} } }, addEventListener(){} };
`;

const PLAYER = `
/* ============================================================
   МОДЕЛЬ ИГРОКА
   Всё, что человек делает руками, описано числами. Меняя их,
   можно спросить «а если играть иначе» — и получить ответ.
   ============================================================ */
const DEFAULT_PLAYER = {
  tps: 3.33,          // тапов в секунду
  buyGear: false,     // докупает ли вещи (на доход не влияют, но тратят деньги)
  catchBonus: 0.85,   // с какой вероятностью успевает схватить бонус
  bonusLag: 4,        // через сколько секунд после появления жмёт
  useAbility: true,   // жмёт ли способность, как только готова
  answerEvents: true, // разбирает ли развилки
  eventLag: 8,        // через сколько секунд отвечает
  pick: 'random'      // 'a' | 'b' | 'random' — что выбирает на развилке
};

/* Покупает всё, что может, начиная с дешёвого */
function buyCheapest(){
  let bought = 0;
  for(;;){
    const opts = unlockedUpgrades().filter(u => owned(u.id) < u.max)
      .map(u => ({ u, c: costOf(u) })).filter(o => o.c <= S.money).sort((a,b) => a.c - b.c);
    if (!opts.length) return bought;
    S.money -= opts[0].c;
    S.owned[opts[0].u.id] = owned(opts[0].u.id) + 1;
    bought++;
  }
}

function buyGearGreedy(){
  for(;;){
    const opts = GEAR.filter(g => gearLevel(g.id) < GEAR_MAX)
      .map(g => ({ g, c: crystalsFor(gearLevel(g.id) + 1) }))
      .filter(o => o.c <= S.crystals).sort((a,b) => a.c - b.c);
    if (!opts.length) return;
    S.crystals -= opts[0].c;
    S.gear[opts[0].g.id] = gearLevel(opts[0].g.id) + 1;
  }
}

/* ============================================================
   ОДИН ЗАБЕГ
   Часы двигаются вручную, поэтому усиления истекают, откат
   заканчивается, а таймеры улучшений тикают как в жизни.
   ============================================================ */
function runOnce(opts){
  const o = { ...DEFAULT_PLAYER, ...(opts || {}) };
  const { carry = null, pathId = 'street', seconds = 900 } = o;

  S = freshRun(pathId, carry);
  buffs = [];
  charges = { left: 0, mult: 1 };
  abilityReadyAt = 0;

  const DT = 0.1, mark = {};
  const t0 = Date.now();
  let t = 0, tapDebt = 0;
  const note = k => { if (mark[k] === undefined) mark[k] = t; };

  // что происходит само по себе
  let nextBonus = bonusDelaySec(true);
  let nextEvent = eventDelaySec(true);
  let bonusOnScreen = null;      // { until, grabAt, type }
  let eventOnScreen = null;      // { at, ev }
  const log = { bonuses: 0, missed: 0, abilities: 0, events: 0, lasting: 0 };

  while (t < seconds){
    __clock = t0 + t * 1000;

    // доход и тапы
    const ps = perSecond();
    S.money += ps * DT; S.totalEarned += ps * DT; S.stats.earnedTotal += ps * DT;

    tapDebt += o.tps * DT;
    while (tapDebt >= 1){
      tapDebt -= 1;
      const gain = perTap() * focusMult();
      S.money += gain; S.totalEarned += gain; S.stats.earnedTotal += gain;
      spendFocus(); spendCharge();
      S.stats.taps++;
    }
    const auto = (perk('avtomat') ? 3 : 0) + (mastered('science') ? 1 : 0);
    if (auto){ const g = perTap() * focusMult() * auto * DT;
               S.money += g; S.totalEarned += g; S.stats.earnedTotal += g; }
    regenFocus(DT);

    // --- бонусы ---
    if (!bonusOnScreen && t >= nextBonus){
      const type = BONUS_TYPES[Math.floor(Math.random() * BONUS_TYPES.length)];
      const life = BONUS_LIFE * (perk('apparat') ? 2.5 : 1);
      const grab = Math.random() < o.catchBonus ? t + Math.min(o.bonusLag, life * 0.8) : Infinity;
      bonusOnScreen = { until: t + life, grabAt: grab, type };
    }
    if (bonusOnScreen){
      if (t >= bonusOnScreen.grabAt){
        bonusOnScreen.type.apply();
        S.stats.bonuses++; log.bonuses++;
        bonusOnScreen = null;
        nextBonus = t + bonusDelaySec(false);
      } else if (t >= bonusOnScreen.until){
        log.missed++;
        bonusOnScreen = null;
        nextBonus = t + bonusDelaySec(false);
      }
    }

    // --- способность ---
    if (o.useAbility && path().ability && abilityLeft() <= 0){
      path().ability.run();
      abilityReadyAt = Date.now() + abilityCooldownSec() * 1000;
      log.abilities++;
      note('первая способность');
    }

    // --- развилки ---
    if (!eventOnScreen && t >= nextEvent){
      const pool = EVENTS[S.path] || [];
      if (pool.length){
        if (!S.seen) S.seen = [];
        let fresh = pool.filter((_, i) => !S.seen.includes(i));
        if (!fresh.length){ S.seen = []; fresh = pool; }
        const ev = fresh[Math.floor(Math.random() * fresh.length)];
        S.seen.push(pool.indexOf(ev));
        eventOnScreen = { at: t + o.eventLag, ev };
      }
    }
    if (eventOnScreen && o.answerEvents && t >= eventOnScreen.at){
      const ev = eventOnScreen.ev;
      const side = o.pick === 'random' ? (Math.random() < 0.5 ? 'a' : 'b') : o.pick;
      ev[side].run();
      log.events++;
      if (ev.lasting) log.lasting++;
      eventOnScreen = null;
      nextEvent = t + eventDelaySec(false);
    }

    // --- покупки ---
    if (buyCheapest() > 0) note('первая покупка');
    for (const pk of path().perks)
      if (!perk(pk.id) && S.money >= pk.cost){
        S.money -= pk.cost; invest(pk.cost); S.perks.push(pk.id);
        note('перк ' + pk.name);
      }
    if (o.buyGear) buyGearGreedy();

    checkMastery(); checkAchievements();

    const p = pendingPoints();
    if (p >= REBIRTH_MIN) note('кнопка перерождения');
    for (const n of [5, 10, 25, 50, 100]) if (p >= n) note(n + ' очков');
    t += DT;
  }

  return { mark, log, points: pendingPoints(), earned: S.totalEarned,
           taps: S.stats.taps, ach: S.achieved.length, perks: S.perks.slice(),
           mods: { ...(S.mods || {}) }, state: S };
}

/* Тратит влияние между забегами: самое дешёвое первым */
function spendInfluence(carry){
  const bought = [];
  for(;;){
    const opts = META.map(m => ({ m, lvl: carry.meta[m.id] || 0 }))
      .filter(o => o.lvl < o.m.max)
      .map(o => ({ ...o, price: metaCost(o.m, o.lvl) }))
      .filter(o => o.price <= carry.legacy)
      .sort((a,b) => a.price - b.price);
    if (!opts.length) return bought;
    const o = opts[0];
    carry.legacy -= o.price;
    carry.meta[o.m.id] = o.lvl + 1;
    bought.push(o.m.name + ' ур.' + (o.lvl + 1));
  }
}

/* Цепочка забегов подряд, с тратой влияния между ними */
function chain(pathIds, minutes, player){
  let carry = null, total = 0;
  const rows = [];
  for (let i = 0; i < pathIds.length; i++){
    const r = runOnce({ ...(player || {}), carry, pathId: pathIds[i], seconds: minutes * 60 });
    total += r.points;
    carry = { ...carryOf(S), legacy: (carry ? carry.legacy : 0) + r.points,
              legacyTotal: total, runs: i + 1 };
    const spent = spendInfluence(carry);
    rows.push({ run: i + 1, pathId: pathIds[i], earned: r.earned, points: r.points,
                total, spent, log: r.log, mods: r.mods,
                mult: 1 + ((carry.meta && carry.meta.vliyanie) || 0) * REBIRTH_BONUS });
  }
  return rows;
}

const mmss = s => s === undefined ? '—' : (s < 60 ? Math.round(s) + 'с'
                                                 : Math.floor(s/60) + 'м ' + Math.round(s%60) + 'с');
const pad  = (s,n) => String(s).padEnd(n);
const rpad = (s,n) => String(s).padStart(n);
`;

/* Исполняет проверки в том же контексте, где живёт игра:
   S, perTap(), PATHS и прочее видны напрямую. */
function report(src){
  const ctx = { console, setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0 };
  vm.createContext(ctx);
  const game = ['content', 'economy', 'systems']
    .map(f => fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8')).join('\n');
  vm.runInContext(BROWSER + game + PLAYER + src, ctx, { filename: 'sim' });
}

module.exports = { report };
