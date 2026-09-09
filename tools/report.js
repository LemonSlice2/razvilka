/* Стандартные проверки баланса. Запуск: node tools/report.js
   Гонять после любой правки экономики — цифры, а не ощущения. */
require('./sim.js').report(`

console.log('=== ОТДАЧА ОТ СКОРОСТИ ТАПА (Улица, 10 минут) ===');
const rates = [1, 2, 3, 3.33, 4, 5, 7, 10, 14];
const byRate = rates.map(r => runOnce({ pathId:'street', tps:r, seconds:600 }));
console.log(pad('тапов/сек',12), rates.map(r => rpad(r, 9)).join(''));
console.log(pad('заработок',12), byRate.map(r => rpad(fmt(r.earned), 9)).join(''));
console.log(pad('концентрация',12), byRate.map(r => rpad(Math.round(r.state.focus) + '%', 9)).join(''));
let mono = true;
for (let i = 1; i < byRate.length; i++) if (byRate[i].earned < byRate[i-1].earned) mono = false;
console.log(pad('',12), mono ? 'быстрее всегда лучше — провала нет'
                             : 'ПРОВАЛ: где-то тапать быстрее невыгодно');
console.log('  разрыв 14/с к 3.33/с: x' + (byRate[8].earned / byRate[3].earned).toFixed(1));

console.log();
console.log('=== ПЕРВЫЙ ЗАБЕГ КАЖДЫМ ПУТЁМ, 15 минут, 3.33 тапа/сек ===');
console.log(pad('путь',10), pad('уклон',22), rpad('1-я покупка',12), rpad('перерождение',14),
            rpad('очков',7), rpad('заработано',12));
for (const p of PATHS){
  const r = runOnce({ pathId:p.id, tps:3.33, seconds:900 });
  console.log(pad(p.name,10), pad('тап x'+p.bias.tap+'  доход x'+p.bias.income,22),
              rpad(mmss(r.mark['первая покупка']),12), rpad(mmss(r.mark['кнопка перерождения']),14),
              rpad(r.points,7), rpad(fmt(r.earned)+'$',12));
}
const spread = PATHS.map(p => runOnce({ pathId:p.id, tps:3.33, seconds:900 }).earned);
console.log('  разброс между путями: x' + (Math.max(...spread)/Math.min(...spread)).toFixed(2));

console.log();
console.log('=== ШЕСТЬ ЗАБЕГОВ ПОДРЯД, по 15 минут ===');
console.log(pad('забег',7), pad('путь',10), rpad('заработано',12), rpad('очков',7),
            rpad('всего',7), rpad('множитель',11));
for (const row of chain(['street','business','politics','science','order','order'], 15, 3.33))
  console.log(pad('#'+row.run,7), pad(PATHS.find(p=>p.id===row.pathId).name,10),
              rpad(fmt(row.earned)+'$',12), rpad(row.points,7), rpad(row.total,7),
              rpad('x'+row.mult.toFixed(2),11));

console.log();
console.log('=== ЧАС ИГРЫ, РАЗНАЯ ДЛИНА ЗАБЕГА ===');
console.log(rpad('забег, мин',11), rpad('забегов',9), rpad('очков за час',14));
const ids = ['street','business','science','politics','order'];
for (const minutes of [2, 5, 10, 15, 20, 30, 60]){
  const n = Math.floor(60 / minutes);
  const rows = chain(Array.from({length:n}, (_,i) => ids[i % ids.length]), minutes, 3.33);
  console.log(rpad(minutes,11), rpad(n,9), rpad(rows[rows.length-1].total,14));
}

console.log();
console.log('=== ЗА СКОЛЬКО ОСВАИВАЕТСЯ ПУТЬ (час игры) ===');
for (const p of PATHS){
  const r = runOnce({ pathId:p.id, tps:3.33, seconds:3600 });
  console.log(pad(p.name,10), 'перки:', p.perks.map(pk => mmss(r.mark['перк ' + pk.name])).join(' / '),
              '| освоен:', r.state.mastered.includes(p.id) ? 'да' : 'нет');
}
`);
