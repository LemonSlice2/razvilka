/* Стенд для баланса.
   Грузит настоящие js/content.js, js/economy.js и js/systems.js, подменяя браузер
   заглушками. Логика забега берётся из игры: концентрация считается теми же
   spendFocus() и regenFocus(), поэтому стенд не может разойтись с игрой.

   Чего стенд не знает: бонусов, развилок и способностей. Значит абсолютные числа
   занижены, а сравнения между путями и настройками — честные.

   Запуск:  node tools/report.js          */

const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');

const BROWSER = `
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

/* Один забег. tps — тапов в секунду. Возвращает отметки времени и итоги. */
function runOnce(opts){
  const { carry = null, pathId = 'street', tps = 3.33, seconds = 900, buyPerks = true } = opts || {};
  S = freshRun(pathId, carry);
  const DT = 0.1, mark = {};
  let t = 0, debt = 0;
  const note = k => { if (mark[k] === undefined) mark[k] = t; };

  while (t < seconds){
    const ps = perSecond();
    S.money += ps * DT; S.totalEarned += ps * DT;

    debt += tps * DT;
    while (debt >= 1){
      debt -= 1;
      const gain = perTap() * focusMult();
      S.money += gain; S.totalEarned += gain;
      spendFocus();                        // тот же код, что в игре
      S.stats.taps++;
    }
    const auto = (perk('avtomat') ? 3 : 0) + (mastered('science') ? 1 : 0);
    if (auto){ const g = perTap() * focusMult() * auto * DT; S.money += g; S.totalEarned += g; }
    regenFocus(DT);                        // и здесь тоже

    if (buyCheapest() > 0) note('первая покупка');
    if (buyPerks) for (const pk of path().perks)
      if (!perk(pk.id) && S.money >= pk.cost){ S.money -= pk.cost; S.perks.push(pk.id); note('перк ' + pk.name); }
    checkMastery(); checkAchievements();

    const p = pendingPoints();
    if (p >= REBIRTH_MIN) note('кнопка перерождения');
    for (const n of [5, 10, 25, 50]) if (p >= n) note(n + ' очков');
    t += DT;
  }
  return { mark, points: pendingPoints(), earned: S.totalEarned, taps: S.stats.taps,
           ach: S.achieved.length, perks: S.perks.slice(), state: S };
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
function chain(pathIds, minutes, tps){
  let carry = null, total = 0;
  const rows = [];
  for (let i = 0; i < pathIds.length; i++){
    const r = runOnce({ carry, pathId: pathIds[i], tps, seconds: minutes * 60 });
    total += r.points;
    carry = { ...carryOf(S), legacy: (carry ? carry.legacy : 0) + r.points,
              legacyTotal: total, runs: i + 1 };
    const spent = spendInfluence(carry);
    rows.push({ run: i + 1, pathId: pathIds[i], earned: r.earned, points: r.points,
                total, spent, mult: 1 + ((carry.meta && carry.meta.vliyanie) || 0) * REBIRTH_BONUS });
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
