/* Стандартные проверки баланса. Запуск: node tools/report.js
   Гонять после любой правки экономики — цифры, а не ощущения. */
require('./sim.js').report(`

console.log('=== ОТДАЧА ОТ СКОРОСТИ ТАПА (Улица, 10 минут) ===');
/* Бонусы и развилки случайны, поэтому один прогон — шум. Усредняем. */
function avg(n, opts, field){
  let s = 0;
  for (let i = 0; i < n; i++){ const r = runOnce(opts); s += field ? r[field] : r.earned; }
  return s / n;
}

const rates = [1, 2, 3, 3.33, 4, 5, 7, 10, 14];
const byRate = rates.map(r => ({ earned: avg(6, { pathId:'street', tps:r, seconds:600 }) }));
console.log(pad('тапов/сек',13), rates.map(r => rpad(r, 9)).join(''));
console.log(pad('заработок',13), byRate.map(r => rpad(fmt(r.earned), 9)).join(''));
console.log(pad('',13), '(среднее по шести прогонам)');
let mono = true;
for (let i = 1; i < byRate.length; i++) if (byRate[i].earned < byRate[i-1].earned * 0.9) mono = false;
console.log(pad('',13), mono ? 'быстрее всегда лучше — провала нет'
                             : 'ПРОВАЛ: где-то тапать быстрее заметно невыгодно');

console.log();
console.log('=== ПУТИ, 15 минут, полная игра ===');
console.log(pad('путь',10), pad('уклон',20), rpad('1-я покупка',12), rpad('перерождение',14),
            rpad('очков',7), rpad('заработано',12), rpad('способность',12));
const spread = [];
for (const p of PATHS){
  const e = avg(6, { pathId:p.id, seconds:900 });
  const pts = avg(6, { pathId:p.id, seconds:900 }, 'points');
  const r = runOnce({ pathId:p.id, seconds:900 });
  spread.push(e);
  console.log(pad(p.name,10), pad('тап x'+p.bias.tap+'  доход x'+p.bias.income,20),
              rpad(mmss(r.mark['первая покупка']),12), rpad(mmss(r.mark['кнопка перерождения']),14),
              rpad(Math.round(pts),7), rpad(fmt(e)+'$',12), rpad(r.log.abilities + ' раз',12));
}
console.log('  разброс между путями: x' + (Math.max(...spread)/Math.min(...spread)).toFixed(2));

console.log();
console.log('=== ЧТО ДАЮТ ОТДЕЛЬНЫЕ СИСТЕМЫ (Улица, 15 минут) ===');
const base = { pathId:'street', seconds:900 };
const variants = [
  ['всё включено',        {}],
  ['без бонусов',         { catchBonus: 0 }],
  ['без способности',     { useAbility: false }],
  ['без развилок',        { answerEvents: false }],
  ['только тапы и покупки',{ catchBonus:0, useAbility:false, answerEvents:false }]
];
const full = avg(6, base);
for (const [label, over] of variants){
  const e = avg(6, { ...base, ...over });
  const d = Math.round((e/full - 1) * 100);
  console.log(pad(label,24), rpad(fmt(e)+'$',12),
              rpad(label === 'всё включено' ? '' : (d >= 0 ? '+' : '') + d + '%', 8));
}

console.log();
console.log('=== ЧТО ВЫБИРАТЬ НА РАЗВИЛКАХ (Улица, 15 минут, по 5 прогонов) ===');
for (const pick of ['a', 'b', 'random']){
  const runs = [];
  for (let i = 0; i < 8; i++) runs.push(runOnce({ pathId:'street', seconds:900, pick }).points);
  const m = runs.reduce((s,x)=>s+x,0)/runs.length;
  console.log(pad('всегда ' + pick,16), 'очков в среднем', rpad(Math.round(m), 5),
              '(разброс ' + Math.min(...runs) + '–' + Math.max(...runs) + ')');
}

console.log();
console.log('=== ШЕСТЬ ЗАБЕГОВ ПОДРЯД, по 20 минут ===');
console.log(pad('забег',7), pad('путь',10), rpad('заработано',12), rpad('очков',7),
            rpad('всего',8), rpad('множитель',11), rpad('бонусов',9));
for (const row of chain(['street','business','politics','science','order','order'], 20))
  console.log(pad('#'+row.run,7), pad(PATHS.find(p=>p.id===row.pathId).name,10),
              rpad(fmt(row.earned)+'$',12), rpad(row.points,7), rpad(row.total,8),
              rpad('x'+row.mult.toFixed(2),11), rpad(row.log.bonuses,9));

console.log();
console.log('=== ЧАС ИГРЫ, РАЗНАЯ ДЛИНА ЗАБЕГА ===');
console.log(rpad('забег, мин',11), rpad('забегов',9), rpad('очков за час',14));
const ids = ['street','business','science','politics','order'];
for (const minutes of [5, 10, 15, 20, 30, 60]){
  const n = Math.floor(60 / minutes);
  const rows = chain(Array.from({length:n}, (_,i) => ids[i % ids.length]), minutes);
  console.log(rpad(minutes,11), rpad(n,9), rpad(rows[rows.length-1].total,14));
}
`);
